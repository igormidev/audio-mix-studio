import {
  transcriptionModels,
  type AlignmentResult,
  type AudioSegment,
  type AudioTrack,
  type MasterClip,
  type MixProject,
  type SentenceGroup,
  type TimedText,
  type Transcript,
} from "../shared/types";

/** Keep a little breathing room around speech, without keeping long silent gaps. */
export const ALIGNMENT_PADDING_SECONDS = 0.06;
const EPSILON = 0.000001;
const MAX_TRACKS = 64;
const MAX_GROUPS = 20_000;
const MAX_SEGMENTS = 50_000;
const MAX_DURATION = 7 * 24 * 60 * 60;

function id(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function updated(project: MixProject): MixProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export function newProject(name = "Untitled mix"): MixProject {
  return {
    version: 1,
    id: id("project"),
    name,
    tracks: [],
    groups: [],
    segments: [],
    model: "large-v3-turbo",
    joinFadeMs: 8,
    updatedAt: new Date().toISOString(),
  };
}

/** Manual imports start as one full-length, active segment per source. */
export function appendTracks(
  project: MixProject,
  incoming: AudioTrack[],
): MixProject {
  if (!incoming.length) return project;
  if (project.tracks.length + incoming.length > MAX_TRACKS)
    throw new Error(`A project supports up to ${MAX_TRACKS} source tracks.`);
  const seen = new Set(project.tracks.map((track) => track.id));
  const tracks = incoming.map((track, index) => {
    const parsed = parseTrack(track, `Imported track ${index + 1}`);
    if (seen.has(parsed.id))
      throw new Error(`Track ID is repeated: ${parsed.id}`);
    seen.add(parsed.id);
    return parsed;
  });
  const groups: SentenceGroup[] = [];
  const segments: AudioSegment[] = [];
  for (const track of tracks) {
    const groupId = id("group");
    const segmentId = id("segment");
    const text = (
      track.transcript?.segments
        .map((segment) => segment.text)
        .join(" ")
        .trim() || track.name
    ).slice(0, 20_000);
    groups.push({
      id: groupId,
      text,
      note: "Full source audio. Analyze to organize it into sentence choices.",
      segmentIds: [segmentId],
    });
    segments.push({
      id: segmentId,
      trackId: track.id,
      groupId,
      start: 0,
      end: track.duration,
      text,
      enabled: true,
    });
  }
  return updated({
    ...project,
    tracks: [...project.tracks, ...tracks],
    groups: [...project.groups, ...groups],
    segments: [...project.segments, ...segments],
  });
}

/** Group order is the output order; within each take, manual cuts stay in source order. */
export function masterClips(project: MixProject): MasterClip[] {
  const byId = new Map(
    project.segments.map((segment) => [segment.id, segment]),
  );
  const trackOrder = new Map(
    project.tracks.map((track, index) => [track.id, index]),
  );
  const clips: MasterClip[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const group of project.groups) {
    const active = group.segmentIds
      .map((segmentId) => byId.get(segmentId))
      .filter((segment): segment is AudioSegment =>
        Boolean(segment?.enabled && segment.groupId === group.id),
      )
      .sort(
        (a, b) =>
          (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) ||
          a.start - b.start ||
          a.end - b.end,
      );
    for (const segment of active) {
      if (seen.has(segment.id)) continue;
      seen.add(segment.id);
      const duration = segment.end - segment.start;
      clips.push({ ...segment, offset, duration });
      offset += duration;
    }
  }
  return clips;
}

export function masterDuration(project: MixProject): number {
  return masterClips(project).reduce(
    (duration, clip) => duration + clip.duration,
    0,
  );
}

/** A variation includes every surviving piece after manual splits or trims. */
export function chooseVariation(
  project: MixProject,
  groupId: string,
  trackId: string,
): MixProject {
  if (
    !project.segments.some(
      (segment) => segment.groupId === groupId && segment.trackId === trackId,
    )
  ) {
    throw new Error("That take is not available for this sentence.");
  }
  return updated({
    ...project,
    segments: project.segments.map((segment) =>
      segment.groupId === groupId
        ? { ...segment, enabled: segment.trackId === trackId }
        : segment,
    ),
  });
}

export function toggleSegment(
  project: MixProject,
  segmentId: string,
): MixProject {
  if (!project.segments.some((segment) => segment.id === segmentId))
    throw new Error("The selected segment no longer exists.");
  return updated({
    ...project,
    segments: project.segments.map((segment) =>
      segment.id === segmentId
        ? { ...segment, enabled: !segment.enabled }
        : segment,
    ),
  });
}

/** Split at an absolute source timestamp. Text is retained on both pieces for context. */
export function splitSegment(
  project: MixProject,
  segmentId: string,
  time: number,
): MixProject {
  const segment = project.segments.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) throw new Error("The selected segment no longer exists.");
  if (
    !Number.isFinite(time) ||
    time <= segment.start + EPSILON ||
    time >= segment.end - EPSILON
  ) {
    throw new Error("Place the cut inside the segment.");
  }
  const tail = { ...segment, id: id("segment"), start: time };
  return updated({
    ...project,
    segments: project.segments.flatMap((candidate) =>
      candidate.id === segmentId
        ? [{ ...candidate, end: time }, tail]
        : [candidate],
    ),
    groups: project.groups.map((group) =>
      group.id === segment.groupId
        ? {
            ...group,
            segmentIds: group.segmentIds.flatMap((candidate) =>
              candidate === segmentId ? [candidate, tail.id] : [candidate],
            ),
          }
        : group,
    ),
  });
}

/** Trims are destructive only to the selection; the original audio file is untouched. */
export function trimSegment(
  project: MixProject,
  segmentId: string,
  start: number,
  end: number,
): MixProject {
  const segment = project.segments.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) throw new Error("The selected segment no longer exists.");
  const track = project.tracks.find(
    (candidate) => candidate.id === segment.trackId,
  );
  if (!track) throw new Error("The source track no longer exists.");
  validateRange(start, end, track.duration, "Trim");
  if (
    project.segments.some(
      (other) =>
        other.id !== segmentId &&
        other.trackId === segment.trackId &&
        start < other.end - EPSILON &&
        end > other.start + EPSILON,
    )
  ) {
    throw new Error(
      "This trim would overlap another segment from the same source.",
    );
  }
  return updated({
    ...project,
    segments: project.segments.map((candidate) =>
      candidate.id === segmentId
        ? {
            ...candidate,
            start: Math.max(0, start),
            end: Math.min(track.duration, end),
          }
        : candidate,
    ),
  });
}

export function moveGroup(
  project: MixProject,
  groupId: string,
  direction: -1 | 1,
): MixProject {
  const index = project.groups.findIndex((group) => group.id === groupId);
  if (index < 0) throw new Error("The selected sentence no longer exists.");
  const target = index + direction;
  if (target < 0 || target >= project.groups.length) return project;
  const groups = [...project.groups];
  [groups[index], groups[target]] = [groups[target], groups[index]];
  return updated({ ...project, groups });
}

export function removeTrack(project: MixProject, trackId: string): MixProject {
  if (!project.tracks.some((track) => track.id === trackId)) return project;
  const removedActiveGroups = new Set(
    project.segments
      .filter((segment) => segment.trackId === trackId && segment.enabled)
      .map((segment) => segment.groupId),
  );
  let segments = project.segments.filter(
    (segment) => segment.trackId !== trackId,
  );
  const survivingIds = new Set(segments.map((segment) => segment.id));
  const groups = project.groups
    .map((group) => ({
      ...group,
      segmentIds: group.segmentIds.filter((segmentId) =>
        survivingIds.has(segmentId),
      ),
    }))
    .filter((group) => group.segmentIds.length > 0);
  // Preserve a sentence when its chosen take was removed; keep deliberately muted groups muted.
  for (const group of groups) {
    const candidates = segments.filter(
      (segment) => segment.groupId === group.id,
    );
    if (
      !removedActiveGroups.has(group.id) ||
      candidates.some((segment) => segment.enabled)
    )
      continue;
    const fallbackTrack = project.tracks.find((track) =>
      candidates.some((segment) => segment.trackId === track.id),
    );
    if (fallbackTrack)
      segments = segments.map((segment) =>
        segment.groupId === group.id && segment.trackId === fallbackTrack.id
          ? { ...segment, enabled: true }
          : segment,
      );
  }
  return updated({
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    segments,
    groups,
  });
}

/** Strict Structured Outputs schema passed to the local Codex CLI. */
export const alignmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "note", "variations"],
        properties: {
          text: { type: "string" },
          note: { type: "string" },
          variations: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["trackId", "start", "end", "text"],
              properties: {
                trackId: { type: "string" },
                start: { type: "number" },
                end: { type: "number" },
                text: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * AI boundaries describe speech. Add at most 60 ms per side, clamping neighboring
 * segments to the midpoint of their silent gap. Long silence outside those padded
 * cuts is intentionally omitted. A source timestamp can never appear twice.
 */
export function applyAlignment(
  project: MixProject,
  value: AlignmentResult | unknown,
): MixProject {
  const root = object(value, "Alignment");
  exactKeys(root, ["groups"], "Alignment");
  const inputGroups = array(root.groups, "Alignment groups", MAX_GROUPS);
  if (!inputGroups.length)
    throw new Error("The analysis did not return any sentences.");
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const rank = new Map(project.tracks.map((track, index) => [track.id, index]));
  const previousGroups = new Map<string, SentenceGroup[]>();
  const previousEnabledTracks = new Map<string, Set<string>>();
  for (const segment of project.segments) {
    if (!segment.enabled) continue;
    const enabled =
      previousEnabledTracks.get(segment.groupId) ?? new Set<string>();
    enabled.add(segment.trackId);
    previousEnabledTracks.set(segment.groupId, enabled);
  }
  for (const group of project.groups) {
    const key = normalizedSentence(group.text);
    previousGroups.set(key, [...(previousGroups.get(key) ?? []), group]);
  }
  const segments: AudioSegment[] = [];
  const groups: SentenceGroup[] = inputGroups.map((value, index) => {
    const input = object(value, `Sentence ${index + 1}`);
    exactKeys(input, ["text", "note", "variations"], `Sentence ${index + 1}`);
    const groupId = id("group");
    const group: SentenceGroup = {
      id: groupId,
      text: string(input.text, "Sentence text", 20_000),
      note: string(input.note, "Sentence note", 8_000, true),
      segmentIds: [],
    };
    const variations = array(
      input.variations,
      "Sentence variations",
      MAX_TRACKS,
    );
    if (!variations.length)
      throw new Error(`Sentence ${index + 1} has no source audio.`);
    const seen = new Set<string>();
    const pieces = variations
      .map((value) => {
        const variation = object(value, "Sentence variation");
        exactKeys(
          variation,
          ["trackId", "start", "end", "text"],
          "Sentence variation",
        );
        const trackId = string(variation.trackId, "Variation track ID", 200);
        const track = tracks.get(trackId);
        if (!track)
          throw new Error(`Analysis refers to an unknown track: ${trackId}`);
        if (seen.has(trackId))
          throw new Error(
            `A sentence contains two variations from ${track.name}.`,
          );
        seen.add(trackId);
        const start = number(variation.start, "Variation start");
        const end = number(variation.end, "Variation end");
        validateRange(start, end, track.duration, `Variation in ${track.name}`);
        return {
          id: id("segment"),
          trackId,
          groupId,
          start: Math.max(0, start),
          end: Math.min(track.duration, end),
          text: string(variation.text, "Variation text", 20_000),
          enabled: false,
        };
      })
      .sort((a, b) => (rank.get(a.trackId) ?? 0) - (rank.get(b.trackId) ?? 0));
    const previous = previousGroups
      .get(normalizedSentence(group.text))
      ?.shift();
    const previousSelections = previous
      ? (previousEnabledTracks.get(previous.id) ?? new Set<string>())
      : undefined;
    const retainSelection =
      previousSelections &&
      (previousSelections.size === 0 ||
        pieces.some((piece) => previousSelections.has(piece.trackId)));
    pieces.forEach((piece, pieceIndex) => {
      piece.enabled = retainSelection
        ? previousSelections.has(piece.trackId)
        : pieceIndex === 0;
      group.segmentIds.push(piece.id);
      segments.push(piece);
    });
    return group;
  });
  if (segments.length > MAX_SEGMENTS)
    throw new Error("The analysis returned too many audio segments.");
  ensureNoOverlap(segments);
  for (const track of project.tracks) {
    const pieces = segments
      .filter((segment) => segment.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    // Compute every boundary before mutating pieces; padding cannot affect its neighbor's calculation.
    const boundaries = pieces.map((piece, index) => ({
      start: Math.max(
        0,
        piece.start - ALIGNMENT_PADDING_SECONDS,
        index ? (pieces[index - 1].end + piece.start) / 2 : 0,
      ),
      end: Math.min(
        track.duration,
        piece.end + ALIGNMENT_PADDING_SECONDS,
        index < pieces.length - 1
          ? (piece.end + pieces[index + 1].start) / 2
          : track.duration,
      ),
    }));
    pieces.forEach((piece, index) => Object.assign(piece, boundaries[index]));
  }
  return updated({ ...project, groups, segments });
}

function normalizedSentence(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** All demo audio must be supplied by the host; this function invents no media. */
export function createDemoProject(tracks: AudioTrack[]): MixProject {
  const project = appendTracks(newProject("Example voice mix"), tracks);
  if (!tracks.length) return project;
  return applyAlignment(project, {
    groups: [
      {
        text: "Listen to each take and choose your favorite.",
        note: "These are real sample recordings. You can also split, trim, and combine them in Manual edits.",
        variations: tracks.map((track) => ({
          trackId: track.id,
          start: 0,
          end: track.duration,
          text:
            track.transcript?.segments
              .map((segment) => segment.text)
              .join(" ") || track.name,
        })),
      },
    ],
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  )
    throw new Error(`${label} has unexpected or missing fields.`);
}

function string(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new Error(
      `${label} must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${max} characters.`,
    );
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} must be an array of at most ${max} items.`);
  return value;
}

function validateRange(
  start: number,
  end: number,
  duration: number,
  label: string,
): void {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < -EPSILON ||
    end > duration + EPSILON ||
    end - start <= EPSILON
  )
    throw new Error(
      `${label} must have a start before its end, within the source audio duration.`,
    );
}

function parseTimedText(
  value: unknown,
  duration: number,
  label: string,
): TimedText {
  const item = object(value, label);
  const start = number(item.start, `${label} start`);
  const end = number(item.end, `${label} end`);
  // Alignment engines can return zero-duration punctuation tokens.
  if (start < -EPSILON || end < start || end > duration + EPSILON)
    throw new Error(`${label} has invalid timestamps.`);
  return {
    start: Math.max(0, start),
    end: Math.min(duration, end),
    text: string(item.text, `${label} text`, 20_000, true),
  };
}

function parseTrack(value: unknown, label: string): AudioTrack {
  const track = object(value, label);
  const duration = number(track.duration, `${label} duration`);
  if (duration <= 0 || duration > MAX_DURATION)
    throw new Error(`${label} has an unsupported duration.`);
  const color = string(track.color, `${label} color`, 32);
  if (!/^#[0-9a-fA-F]{6}$/.test(color))
    throw new Error(`${label} must have a six-digit hex color.`);
  const peaks = array(track.peaks, `${label} waveform`, 200_000).map(
    (value) => {
      const peak = number(value, `${label} waveform peak`);
      if (peak < 0 || peak > 1)
        throw new Error(`${label} waveform peaks must be between 0 and 1.`);
      return peak;
    },
  );
  let transcript: Transcript | undefined;
  if (track.transcript !== undefined) {
    const input = object(track.transcript, `${label} transcript`);
    transcript = {
      model: string(input.model, "Transcript model", 200),
      language:
        input.language === null
          ? null
          : string(input.language, "Transcript language", 100),
      segments: array(input.segments, "Transcript segments", 100_000).map(
        (value) => parseTimedText(value, duration, "Transcript segment"),
      ),
      words: array(input.words, "Transcript words", 250_000).map((value) =>
        parseTimedText(value, duration, "Transcript word"),
      ),
    };
  }
  return {
    id: string(track.id, `${label} ID`, 200),
    name: string(track.name, `${label} name`, 1_000),
    duration,
    color,
    peaks,
    mediaUrl: string(track.mediaUrl, `${label} media URL`, 16_384),
    ...(transcript ? { transcript } : {}),
  };
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate IDs.`);
}

function ensureNoOverlap(segments: AudioSegment[]): void {
  const byTrack = new Map<string, AudioSegment[]>();
  for (const segment of segments) {
    const trackSegments = byTrack.get(segment.trackId) ?? [];
    trackSegments.push(segment);
    byTrack.set(segment.trackId, trackSegments);
  }
  for (const items of byTrack.values()) {
    items.sort((a, b) => a.start - b.start);
    for (let index = 1; index < items.length; index++) {
      if (items[index].start < items[index - 1].end - EPSILON)
        throw new Error(
          "Audio segments from the same source overlap. Analyze again or correct the project timestamps.",
        );
    }
  }
}

/** Rebuild an untrusted saved project from explicitly validated fields. Throws on invalid data. */
export function parseProject(value: unknown): MixProject {
  const input = object(value, "Project");
  if (input.version !== 1)
    throw new Error("This project version is not supported.");
  const tracks = array(input.tracks, "Project tracks", MAX_TRACKS).map(
    (track, index) => parseTrack(track, `Track ${index + 1}`),
  );
  unique(
    tracks.map((track) => track.id),
    "Tracks",
  );
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  let referenceCount = 0;
  const groups: SentenceGroup[] = array(
    input.groups,
    "Project sentences",
    MAX_GROUPS,
  ).map((value) => {
    const group = object(value, "Sentence");
    const segmentIds = array(
      group.segmentIds,
      "Sentence segment IDs",
      MAX_SEGMENTS,
    ).map((value) => string(value, "Sentence segment ID", 200));
    referenceCount += segmentIds.length;
    if (referenceCount > MAX_SEGMENTS)
      throw new Error(
        "The project contains too many sentence segment references.",
      );
    if (!segmentIds.length)
      throw new Error("A sentence must contain at least one audio segment.");
    unique(segmentIds, "Sentence segment IDs");
    return {
      id: string(group.id, "Sentence ID", 200),
      text: string(group.text, "Sentence text", 20_000),
      note: string(group.note, "Sentence note", 8_000, true),
      segmentIds,
    };
  });
  unique(
    groups.map((group) => group.id),
    "Sentences",
  );
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const segments: AudioSegment[] = array(
    input.segments,
    "Project segments",
    MAX_SEGMENTS,
  ).map((value) => {
    const segment = object(value, "Segment");
    const trackId = string(segment.trackId, "Segment track ID", 200);
    const track = trackMap.get(trackId);
    if (!track)
      throw new Error("An audio segment refers to a missing source track.");
    const groupId = string(segment.groupId, "Segment sentence ID", 200);
    if (!groupMap.has(groupId))
      throw new Error("An audio segment refers to a missing sentence.");
    const start = number(segment.start, "Segment start");
    const end = number(segment.end, "Segment end");
    validateRange(start, end, track.duration, "Audio segment");
    if (typeof segment.enabled !== "boolean")
      throw new Error("Segment selection must be a boolean.");
    return {
      id: string(segment.id, "Segment ID", 200),
      trackId,
      groupId,
      start: Math.max(0, start),
      end: Math.min(track.duration, end),
      text: string(segment.text, "Segment text", 20_000, true),
      enabled: segment.enabled,
    };
  });
  unique(
    segments.map((segment) => segment.id),
    "Audio segments",
  );
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));
  const referenced = new Set<string>();
  for (const group of groups)
    for (const segmentId of group.segmentIds) {
      const segment = segmentMap.get(segmentId);
      if (!segment || segment.groupId !== group.id || referenced.has(segmentId))
        throw new Error("Sentence and segment references are inconsistent.");
      referenced.add(segmentId);
    }
  if (referenced.size !== segments.length)
    throw new Error("Some audio segments are not assigned to a sentence.");
  ensureNoOverlap(segments);
  const model = input.model;
  if (
    typeof model !== "string" ||
    !transcriptionModels.includes(model as MixProject["model"])
  )
    throw new Error("The selected transcription model is not supported.");
  const joinFadeMs = number(input.joinFadeMs, "Join fade");
  if (joinFadeMs < 0 || joinFadeMs > 100)
    throw new Error("Join fade must be between 0 and 100 milliseconds.");
  const updatedAt = string(input.updatedAt, "Project save date", 100);
  if (!Number.isFinite(Date.parse(updatedAt)))
    throw new Error("Project save date is invalid.");
  return {
    version: 1,
    id: string(input.id, "Project ID", 200),
    name: string(input.name, "Project name", 1_000),
    tracks,
    groups,
    segments,
    model: model as MixProject["model"],
    joinFadeMs,
    updatedAt,
  };
}
