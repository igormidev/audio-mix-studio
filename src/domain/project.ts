import { parseSoundMix, validAudioRole, validPlaybackSpeed } from "./soundMix";
import {
  transcriptionModels,
  type AlignmentResult,
  type AudioSegment,
  type AudioTrack,
  type MasterClip,
  type MasterTimelineClip,
  type MixProject,
  type SentenceGroup,
  type TimedText,
  type Transcript,
  type JointSettings,
  type CodexSelection,
  type CodexModelInfo,
} from "../shared/types";

/** Used only to recognize and migrate the previous automatic boundary policy. */
export const ALIGNMENT_PADDING_SECONDS = 0.06;
export const DEFAULT_JOINT_SETTINGS: JointSettings = {
  pauseMs: 0,
  fadeOutMs: 0,
  fadeInMs: 0,
};
export const DEFAULT_CODEX_SELECTION: CodexSelection = {
  model: "gpt-6-luna",
  reasoning: "medium",
  fast: false,
};
export const sentenceSpeeds = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5,
] as const;
const EPSILON = 0.000001;
const MAX_TRACKS = 64;
const MAX_GROUPS = 20_000;
const MAX_SEGMENTS = 50_000;
const MAX_DURATION = 7 * 24 * 60 * 60;

export class UnsupportedAudioSchemaError extends Error {
  constructor(message = "This audio editing schema is not supported.") {
    super(message);
    this.name = "UnsupportedAudioSchemaError";
  }
}

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
    joinFadeMs: 0,
    audioSchema: 2,
    jointDefaults: { ...DEFAULT_JOINT_SETTINGS },
    jointOverrides: {},
    codex: { ...DEFAULT_CODEX_SELECTION },
    updatedAt: new Date().toISOString(),
  };
}

export function validCodexSelection(
  value: CodexSelection | undefined,
  models: CodexModelInfo[],
): CodexSelection {
  const choice = value ?? DEFAULT_CODEX_SELECTION;
  const model =
    models.find((model) => model.id === choice.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  if (!model) return { ...choice };
  return {
    model: model.id,
    reasoning: model.reasoning.includes(choice.reasoning)
      ? choice.reasoning
      : model.defaultReasoning,
    fast: choice.fast && model.fast,
  };
}

export function jointKey(leftGroupId: string, rightGroupId: string): string {
  return JSON.stringify([leftGroupId, rightGroupId]);
}

export function effectiveJointSettings(
  project: MixProject,
  leftGroupId: string,
  rightGroupId: string,
): JointSettings {
  return {
    ...DEFAULT_JOINT_SETTINGS,
    ...project.jointDefaults,
    ...project.jointOverrides?.[jointKey(leftGroupId, rightGroupId)],
  };
}

function checkedJoint(value: unknown, partial = false): Partial<JointSettings> {
  const input = object(value, "Joint settings");
  const result: Partial<JointSettings> = {};
  for (const key of Object.keys(input)) {
    if (!["pauseMs", "fadeOutMs", "fadeInMs"].includes(key))
      throw new Error("Joint settings contain an unknown field.");
  }
  for (const key of ["pauseMs", "fadeOutMs", "fadeInMs"] as const) {
    if (input[key] === undefined && partial) continue;
    const value = number(input[key], `Joint ${key}`);
    if (value < 0 || value > (key === "pauseMs" ? 10_000 : 5_000))
      throw new Error(`Joint ${key} is outside its supported range.`);
    result[key] = value;
  }
  return result;
}

export function setGroupSpeed(
  project: MixProject,
  groupId: string,
  speed: number,
): MixProject {
  validPlaybackSpeed(speed);
  const group = project.groups.find((group) => group.id === groupId);
  if (!group) throw new Error("The selected sentence no longer exists.");
  if ((group.speed ?? 1) === speed) return project;
  return updated({
    ...project,
    groups: project.groups.map((group) =>
      group.id === groupId ? { ...group, speed } : group,
    ),
  });
}

export function setJointDefaults(
  project: MixProject,
  settings: Partial<JointSettings>,
): MixProject {
  const jointDefaults = {
    ...DEFAULT_JOINT_SETTINGS,
    ...project.jointDefaults,
    ...checkedJoint(settings, true),
  };
  return updated({ ...project, jointDefaults });
}

export function setJointOverride(
  project: MixProject,
  leftGroupId: string,
  rightGroupId: string,
  settings: Partial<JointSettings> | null,
): MixProject {
  if (
    leftGroupId === rightGroupId ||
    !project.groups.some((group) => group.id === leftGroupId) ||
    !project.groups.some((group) => group.id === rightGroupId)
  )
    throw new Error("A joint must connect two existing sentences.");
  const key = jointKey(leftGroupId, rightGroupId);
  const jointOverrides = { ...project.jointOverrides };
  if (settings === null) delete jointOverrides[key];
  else {
    const next = { ...jointOverrides[key] };
    checkedJoint(settings, true);
    for (const field of Object.keys(settings) as (keyof JointSettings)[]) {
      if (settings[field] === undefined) delete next[field];
      else next[field] = settings[field];
    }
    if (Object.keys(next).length) jointOverrides[key] = next;
    else delete jointOverrides[key];
  }
  return updated({ ...project, jointOverrides });
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
    if (parsed.sentenceGroupId !== undefined)
      throw new Error(
        "A sentence choice must be added to its target sentence.",
      );
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
      speed: 1,
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

/** Add full-length source alternatives without changing the current master choice. */
export function appendSentenceAlternatives(
  project: MixProject,
  groupId: string,
  incoming: AudioTrack[],
): MixProject {
  const group = project.groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error("The selected sentence no longer exists.");
  if (!incoming.length) return project;
  if (project.tracks.length + incoming.length > MAX_TRACKS)
    throw new Error(`A project supports up to ${MAX_TRACKS} source tracks.`);
  if (project.segments.length + incoming.length > MAX_SEGMENTS)
    throw new Error("The project contains too many audio segments.");
  const seen = new Set(project.tracks.map((track) => track.id));
  const tracks = incoming.map((track, index) => {
    const parsed = parseTrack(track, `Sentence audio ${index + 1}`);
    if (seen.has(parsed.id))
      throw new Error(`Track ID is repeated: ${parsed.id}`);
    if (
      parsed.sentenceGroupId !== undefined &&
      parsed.sentenceGroupId !== groupId
    )
      throw new Error("This audio choice belongs to another sentence.");
    seen.add(parsed.id);
    return { ...parsed, sentenceGroupId: groupId };
  });
  const segments = tracks.map((track): AudioSegment => ({
    id: id("segment"),
    trackId: track.id,
    groupId,
    start: 0,
    end: track.duration,
    text: (
      track.transcript?.segments
        .map((segment) => segment.text)
        .join(" ")
        .trim() || track.name
    ).slice(0, 20_000),
    enabled: false,
  }));
  return updated({
    ...project,
    tracks: [...project.tracks, ...tracks],
    segments: [...project.segments, ...segments],
    groups: project.groups.map((candidate) =>
      candidate.id === groupId
        ? {
            ...candidate,
            segmentIds: [
              ...candidate.segmentIds,
              ...segments.map((segment) => segment.id),
            ],
          }
        : candidate,
    ),
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
        Boolean(
          segment?.enabled && !segment.excluded && segment.groupId === group.id,
        ),
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
      const sourceDuration =
        (Math.round(segment.end * 48_000) -
          Math.round(segment.start * 48_000)) /
        48_000;
      const speed = group.speed ?? 1;
      const duration = Math.round((sourceDuration * 48_000) / speed) / 48_000;
      // A retained source fragment can quantize to zero output samples at high
      // speed. Keep its source edit, but never send a zero-frame clip to audio.
      if (duration === 0) continue;
      let pauseBeforeMs = 0;
      let fadeInMs = 0;
      const previous = clips[clips.length - 1];
      if (previous && previous.groupId !== group.id) {
        const joint = effectiveJointSettings(
          project,
          previous.groupId,
          group.id,
        );
        pauseBeforeMs = joint.pauseMs;
        fadeInMs = Math.min(joint.fadeInMs, duration * 1000);
        previous.fadeOutMs = Math.min(
          joint.fadeOutMs,
          previous.duration * 1000,
        );
        offset += Math.round(pauseBeforeMs * 48) / 48_000;
      }
      clips.push({
        ...segment,
        offset,
        duration,
        sourceDuration,
        speed,
        pauseBeforeMs,
        fadeInMs,
        fadeOutMs: 0,
      });
      offset += duration;
    }
  }
  return clips;
}

export function masterDuration(project: MixProject): number {
  const clips = masterClips(project);
  const last = clips[clips.length - 1];
  return last ? last.offset + last.duration : 0;
}

/** The visible assembly retains selected cut pieces; playback omits them. */
export function masterTimelineClips(project: MixProject): MasterTimelineClip[] {
  const audible = new Map(masterClips(project).map((clip) => [clip.id, clip]));
  const byId = new Map(
    project.segments.map((segment) => [segment.id, segment]),
  );
  const trackOrder = new Map(
    project.tracks.map((track, index) => [track.id, index]),
  );
  const seen = new Set<string>();
  const timeline: MasterTimelineClip[] = [];
  let visualOffset = 0;
  let playbackOffset = 0;
  for (const group of project.groups) {
    const selected = group.segmentIds
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
    for (const segment of selected) {
      if (seen.has(segment.id)) continue;
      seen.add(segment.id);
      const clip = audible.get(segment.id);
      if (clip) {
        visualOffset += Math.round((clip.pauseBeforeMs ?? 0) * 48) / 48_000;
        timeline.push({
          ...clip,
          offset: visualOffset,
          playbackOffset: clip.offset,
        });
        visualOffset += clip.duration;
        playbackOffset = clip.offset + clip.duration;
      } else {
        const sourceDuration =
          (Math.round(segment.end * 48_000) -
            Math.round(segment.start * 48_000)) /
          48_000;
        const speed = group.speed ?? 1;
        const duration = Math.round((sourceDuration * 48_000) / speed) / 48_000;
        timeline.push({
          ...segment,
          offset: visualOffset,
          duration,
          sourceDuration,
          speed,
          pauseBeforeMs: 0,
          fadeInMs: 0,
          fadeOutMs: 0,
          playbackOffset,
        });
        visualOffset += duration;
      }
    }
  }
  return timeline;
}

export function masterTimelineDuration(project: MixProject): number {
  const clips = masterTimelineClips(project);
  const last = clips.at(-1);
  return last ? last.offset + last.duration : 0;
}

/** Right-biased boundaries make the cursor jump immediately over omitted audio. */
export function masterToTimelineTime(
  timeline: MasterTimelineClip[],
  time: number,
): number {
  if (!Number.isFinite(time)) throw new Error("Playback time must be finite.");
  const target = Math.max(0, time);
  for (const clip of timeline) {
    if (clip.excluded) continue;
    const pause = Math.round((clip.pauseBeforeMs ?? 0) * 48) / 48_000;
    const pauseStart = clip.playbackOffset - pause;
    if (target >= pauseStart && target < clip.playbackOffset)
      return clip.offset - pause + target - pauseStart;
    if (
      target >= clip.playbackOffset &&
      target < clip.playbackOffset + clip.duration
    )
      return clip.offset + target - clip.playbackOffset;
  }
  const last = timeline.at(-1);
  return last ? last.offset + last.duration : 0;
}

/** A seek into a gray cut resolves to its compressed playback boundary. */
export function timelineToMasterTime(
  timeline: MasterTimelineClip[],
  time: number,
): number {
  if (!Number.isFinite(time)) throw new Error("Timeline time must be finite.");
  const target = Math.max(0, time);
  for (const clip of timeline) {
    const pause = Math.round((clip.pauseBeforeMs ?? 0) * 48) / 48_000;
    if (target >= clip.offset - pause && target < clip.offset)
      return clip.playbackOffset - pause + target - (clip.offset - pause);
    if (target >= clip.offset && target < clip.offset + clip.duration)
      return clip.playbackOffset + (clip.excluded ? 0 : target - clip.offset);
  }
  const last = timeline.at(-1);
  return last ? last.playbackOffset + (last.excluded ? 0 : last.duration) : 0;
}

/** Cut only the selected source samples intersecting a visible master drag. */
export function excludeMasterRange(
  project: MixProject,
  start: number,
  end: number,
): MixProject {
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw new Error("A master cut must have finite boundaries.");
  const left = Math.max(0, Math.min(start, end));
  const right = Math.max(0, Math.max(start, end));
  if (left === right) return project;
  const replacements = new Map<string, AudioSegment[]>();
  const sources = new Map(
    project.segments.map((segment) => [segment.id, segment]),
  );
  for (const clip of masterTimelineClips(project)) {
    if (clip.excluded || clip.duration <= 0) continue;
    const cutStart = Math.max(left, clip.offset);
    const cutEnd = Math.min(right, clip.offset + clip.duration);
    if (cutEnd <= cutStart) continue;
    const firstFrame = Math.round(clip.start * 48_000);
    const lastFrame = Math.round(clip.end * 48_000);
    const frames = lastFrame - firstFrame;
    const from = Math.max(
      firstFrame,
      Math.min(
        lastFrame,
        firstFrame +
          Math.round(((cutStart - clip.offset) / clip.duration) * frames),
      ),
    );
    const to = Math.max(
      firstFrame,
      Math.min(
        lastFrame,
        firstFrame +
          Math.round(((cutEnd - clip.offset) / clip.duration) * frames),
      ),
    );
    if (to <= from) continue;
    const source = sources.get(clip.id)!;
    const parts: AudioSegment[] = [];
    const append = (from: number, to: number, excluded: boolean) => {
      parts.push({
        ...source,
        id: parts.length ? id("segment") : source.id,
        start: from / 48_000,
        end: to / 48_000,
        ...(excluded ? { excluded: true } : {}),
      });
    };
    if (from > firstFrame) append(firstFrame, from, false);
    append(from, to, true);
    if (to < lastFrame) append(to, lastFrame, false);
    replacements.set(source.id, parts);
  }
  if (!replacements.size) return project;
  const segments = project.segments.flatMap(
    (segment) => replacements.get(segment.id) ?? [segment],
  );
  if (segments.length > MAX_SEGMENTS)
    throw new Error("The project contains too many audio segments.");
  return updated({
    ...project,
    segments,
    groups: project.groups.map((group) => ({
      ...group,
      segmentIds: group.segmentIds.flatMap(
        (segmentId) =>
          replacements.get(segmentId)?.map((segment) => segment.id) ?? [
            segmentId,
          ],
      ),
    })),
  });
}

export function restoreMasterSegment(
  project: MixProject,
  segmentId: string,
): MixProject {
  const segment = project.segments.find(
    (candidate) => candidate.id === segmentId,
  );
  if (!segment) throw new Error("The selected segment no longer exists.");
  if (!segment.excluded) return project;
  return updated({
    ...project,
    segments: project.segments.map((candidate) =>
      candidate.id === segmentId
        ? { ...candidate, excluded: false }
        : candidate,
    ),
  });
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
        ? segment.excluded
          ? { ...segment, enabled: true, excluded: false }
          : { ...segment, enabled: !segment.enabled }
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
  const survivingGroups = new Set(groups.map((group) => group.id));
  const jointOverrides = Object.fromEntries(
    Object.entries(project.jointOverrides ?? {}).filter(([key]) =>
      (JSON.parse(key) as string[]).every((id) => survivingGroups.has(id)),
    ),
  );
  return updated({
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    segments,
    groups,
    jointOverrides,
    ...(project.soundMix
      ? {
          soundMix: {
            ...project.soundMix,
            placements: project.soundMix.placements.filter(
              (clip) => clip.trackId !== trackId,
            ),
          },
        }
      : {}),
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
 * Partition every source from zero through its end. Silence between spoken
 * ranges belongs half to each neighbor; selecting a whole take preserves it.
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
  const scopedIds = new Set(
    project.tracks
      .filter((track) => track.sentenceGroupId !== undefined)
      .map((track) => track.id),
  );
  if (
    project.segments.some(
      (segment) => segment.excluded && !scopedIds.has(segment.trackId),
    )
  )
    throw new Error(
      "Regrouping would replace removed master audio. Restore the removed ranges or undo their cuts before regrouping.",
    );
  const tracks = new Map(
    project.tracks
      .filter(
        (track) =>
          track.sentenceGroupId === undefined &&
          (track.role ?? "voiceover") === "voiceover",
      )
      .map((track) => [track.id, track]),
  );
  const scopedTracks = project.tracks.filter(
    (track) => track.sentenceGroupId !== undefined,
  );
  const scopedTrackIds = new Set(scopedTracks.map((track) => track.id));
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
  // Regrouping repeated labels by occurrence is unsafe after reordering groups.
  // Preserve the old project unless a replacement's owner has a unique label.
  for (const track of scopedTracks) {
    const owner = project.groups.find(
      (group) => group.id === track.sentenceGroupId,
    );
    if (!owner)
      throw new Error("An audio choice refers to a missing sentence.");
    const key = normalizedSentence(owner.text);
    const oldCount = previousGroups.get(key)?.length ?? 0;
    const newCount = inputGroups.filter((value) => {
      const entry = object(value, "Sentence");
      return (
        normalizedSentence(string(entry.text, "Sentence text", 20_000)) === key
      );
    }).length;
    if (oldCount > 1 || newCount > 1)
      throw new Error(
        "Regrouping cannot safely identify a repeated sentence with added audio. Remove its added audio choices before regrouping.",
      );
  }
  const segments: AudioSegment[] = [];
  const groups: SentenceGroup[] = inputGroups.map((value, index) => {
    const input = object(value, `Sentence ${index + 1}`);
    exactKeys(input, ["text", "note", "variations"], `Sentence ${index + 1}`);
    const text = string(input.text, "Sentence text", 20_000);
    const previous = previousGroups.get(normalizedSentence(text))?.shift();
    const groupId = previous?.id ?? id("group");
    const group: SentenceGroup = {
      id: groupId,
      text,
      note: string(input.note, "Sentence note", 8_000, true),
      segmentIds: [],
      speed: previous?.speed ?? 1,
    };
    const variations = array(
      input.variations,
      "Sentence variations",
      MAX_TRACKS,
    );
    if (!variations.length)
      throw new Error(`Sentence ${index + 1} has no source audio.`);
    const seen = new Set<string>();
    const pieces: AudioSegment[] = variations
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
    if (previous)
      pieces.push(
        ...project.segments
          .filter(
            (segment) =>
              segment.groupId === previous.id &&
              scopedTrackIds.has(segment.trackId),
          )
          .map((segment) => ({ ...segment })),
      );
    const previousSelections = previous
      ? (previousEnabledTracks.get(previous.id) ?? new Set<string>())
      : undefined;
    const retainSelection =
      previousSelections &&
      (previousSelections.size === 0 ||
        pieces.some((piece) => previousSelections.has(piece.trackId)));
    pieces.forEach((piece, pieceIndex) => {
      if (!scopedTrackIds.has(piece.trackId))
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
  const ids = new Set(groups.map((group) => group.id));
  if (scopedTracks.some((track) => !ids.has(track.sentenceGroupId!)))
    throw new Error(
      "Regrouping changed a sentence with added audio. Remove its added audio choices before regrouping.",
    );
  ensureNoOverlap(segments);
  for (const track of tracks.values()) {
    const pieces = segments
      .filter((segment) => segment.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    // Compute all midpoints before mutating speech ranges.
    const boundaries = pieces.map((piece, index) => ({
      start: index ? sampleTime((pieces[index - 1].end + piece.start) / 2) : 0,
      end:
        index < pieces.length - 1
          ? sampleTime((piece.end + pieces[index + 1].start) / 2)
          : track.duration,
    }));
    pieces.forEach((piece, index) => Object.assign(piece, boundaries[index]));
  }
  const jointOverrides = Object.fromEntries(
    Object.entries(project.jointOverrides ?? {}).filter(([key]) => {
      const pair = JSON.parse(key) as string[];
      return pair.every((id) => ids.has(id));
    }),
  );
  return updated({
    ...project,
    audioSchema: 2,
    groups,
    segments,
    jointOverrides,
  });
}

function sampleTime(seconds: number): number {
  return Math.round(seconds * 48_000) / 48_000;
}

/**
 * Recover only entire tracks whose unsplit segments still exactly match the
 * previous automatic 60 ms policy and independently match real transcript text.
 * Any ambiguous match or changed boundary leaves the track untouched.
 */
function migrateLegacyBoundaries(
  tracks: AudioTrack[],
  segments: AudioSegment[],
): AudioSegment[] {
  const replacements = new Map<string, { start: number; end: number }>();
  const compact = (text: string) => normalizedSentence(text).replace(/\s/g, "");
  for (const track of tracks) {
    if (!track.transcript || track.sentenceGroupId !== undefined) continue;
    const pieces = segments
      .filter((segment) => segment.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    if (
      !pieces.length ||
      new Set(pieces.map((piece) => piece.groupId)).size !== pieces.length
    )
      continue;
    const sources = [track.transcript.words, track.transcript.segments]
      .filter((units) => units.length)
      .map((units) => {
        let text = "";
        const starts = new Map<number, number>();
        const ends = new Map<number, number>();
        units.forEach((unit, index) => {
          const token = compact(unit.text);
          if (!token) return;
          starts.set(text.length, index);
          text += token;
          ends.set(text.length, index);
        });
        return { units, text, starts, ends };
      });
    const speech: { start: number; end: number }[] = [];
    for (const piece of pieces) {
      const target = compact(piece.text);
      const matches = new Map<string, { start: number; end: number }>();
      if (target)
        for (const source of sources) {
          let position = source.text.indexOf(target);
          while (position >= 0) {
            const first = source.starts.get(position);
            const last = source.ends.get(position + target.length);
            if (first !== undefined && last !== undefined) {
              const start = source.units[first].start;
              const end = source.units[last].end;
              if (
                start >= piece.start - EPSILON &&
                start - piece.start <= ALIGNMENT_PADDING_SECONDS + 1 / 48_000 &&
                end <= piece.end + EPSILON &&
                piece.end - end <= ALIGNMENT_PADDING_SECONDS + 1 / 48_000
              )
                matches.set(`${start}:${end}`, { start, end });
            }
            position = source.text.indexOf(target, position + 1);
          }
        }
      if (matches.size !== 1) break;
      speech.push([...matches.values()][0]);
    }
    if (speech.length !== pieces.length) continue;
    const pristine = pieces.every((piece, index) => {
      const expectedStart = Math.max(
        0,
        speech[index].start - ALIGNMENT_PADDING_SECONDS,
        index ? (speech[index - 1].end + speech[index].start) / 2 : 0,
      );
      const expectedEnd = Math.min(
        track.duration,
        speech[index].end + ALIGNMENT_PADDING_SECONDS,
        index < pieces.length - 1
          ? (speech[index].end + speech[index + 1].start) / 2
          : track.duration,
      );
      return (
        Math.abs(piece.start - expectedStart) <= 1 / 48_000 &&
        Math.abs(piece.end - expectedEnd) <= 1 / 48_000
      );
    });
    if (!pristine) continue;
    pieces.forEach((piece, index) =>
      replacements.set(piece.id, {
        start: index
          ? sampleTime((speech[index - 1].end + speech[index].start) / 2)
          : 0,
        end:
          index < pieces.length - 1
            ? sampleTime((speech[index].end + speech[index + 1].start) / 2)
            : track.duration,
      }),
    );
  }
  return segments.map((segment) =>
    replacements.has(segment.id)
      ? { ...segment, ...replacements.get(segment.id)! }
      : segment,
  );
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
        note: "These are real sample recordings. Choose a take here, then arrange music and sound effects in the mix workspace.",
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

function parseAudioOrigin(value: unknown): NonNullable<AudioTrack["origin"]> {
  const input = object(value, "Audio origin");
  if (
    input.provider !== "epidemic-sound" ||
    (input.kind !== "music" && input.kind !== "soundtrack") ||
    (input.format !== "WAV" && input.format !== "MP3") ||
    !["FULL", "BASS", "DRUMS", "INSTRUMENTS"].includes(input.stem as string)
  )
    throw new Error("Invalid Epidemic Sound audio origin.");
  const sourceId = string(input.id, "Epidemic Sound source ID", 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
      sourceId,
    )
  )
    throw new Error("Invalid Epidemic Sound source ID.");
  return {
    provider: "epidemic-sound",
    id: sourceId,
    kind: input.kind,
    format: input.format,
    stem: input.stem as string,
    artists: array(input.artists, "Epidemic Sound artists", 50).map((value) =>
      string(value, "Epidemic Sound artist", 300),
    ),
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
    ...(track.role !== undefined ? { role: validAudioRole(track.role) } : {}),
    ...(track.origin !== undefined
      ? { origin: parseAudioOrigin(track.origin) }
      : {}),
    ...(track.sentenceGroupId !== undefined
      ? {
          sentenceGroupId: string(
            track.sentenceGroupId,
            `${label} sentence ID`,
            200,
          ),
        }
      : {}),
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
  if (input.version !== 1) {
    if (
      typeof input.version === "number" &&
      Number.isFinite(input.version) &&
      input.version > 0
    )
      throw new UnsupportedAudioSchemaError(
        "This project version is not supported.",
      );
    throw new Error("The project version is invalid.");
  }
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
    const speed =
      group.speed === undefined ? 1 : number(group.speed, "Sentence speed");
    validPlaybackSpeed(speed);
    return {
      id: string(group.id, "Sentence ID", 200),
      text: string(group.text, "Sentence text", 20_000),
      note: string(group.note, "Sentence note", 8_000, true),
      segmentIds,
      speed,
    };
  });
  unique(
    groups.map((group) => group.id),
    "Sentences",
  );
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  for (const track of tracks)
    if (
      track.sentenceGroupId !== undefined &&
      !groupMap.has(track.sentenceGroupId)
    )
      throw new Error("An audio choice refers to a missing sentence.");
  let segments: AudioSegment[] = array(
    input.segments,
    "Project segments",
    MAX_SEGMENTS,
  ).map((value) => {
    const segment = object(value, "Segment");
    const trackId = string(segment.trackId, "Segment track ID", 200);
    const track = trackMap.get(trackId);
    if (!track)
      throw new Error("An audio segment refers to a missing source track.");
    if ((track.role ?? "voiceover") !== "voiceover")
      throw new Error("Only voiceover sources can be sentence choices.");
    const groupId = string(segment.groupId, "Segment sentence ID", 200);
    if (!groupMap.has(groupId))
      throw new Error("An audio segment refers to a missing sentence.");
    if (
      track.sentenceGroupId !== undefined &&
      track.sentenceGroupId !== groupId
    )
      throw new Error("An audio choice is assigned to the wrong sentence.");
    const start = number(segment.start, "Segment start");
    const end = number(segment.end, "Segment end");
    validateRange(start, end, track.duration, "Audio segment");
    if (typeof segment.enabled !== "boolean")
      throw new Error("Segment selection must be a boolean.");
    if (segment.excluded !== undefined && typeof segment.excluded !== "boolean")
      throw new Error("Segment exclusion must be a boolean.");
    return {
      id: string(segment.id, "Segment ID", 200),
      trackId,
      groupId,
      start: Math.max(0, start),
      end: Math.min(track.duration, end),
      text: string(segment.text, "Segment text", 20_000, true),
      enabled: segment.enabled,
      ...(segment.excluded !== undefined ? { excluded: segment.excluded } : {}),
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
  for (const track of tracks)
    if (
      track.sentenceGroupId !== undefined &&
      !segments.some((segment) => segment.trackId === track.id)
    )
      throw new Error("A sentence audio choice has no source segments.");
  ensureNoOverlap(segments);
  if (input.audioSchema !== undefined && input.audioSchema !== 2) {
    if (
      typeof input.audioSchema === "number" &&
      Number.isFinite(input.audioSchema) &&
      input.audioSchema > 0
    )
      throw new UnsupportedAudioSchemaError();
    throw new Error("The project audio editing schema is invalid.");
  }
  if (input.audioSchema === undefined)
    segments = migrateLegacyBoundaries(tracks, segments);
  ensureNoOverlap(segments);
  const model = input.model;
  if (
    typeof model !== "string" ||
    !transcriptionModels.includes(model as MixProject["model"])
  )
    throw new Error("The selected transcription model is not supported.");
  const joinFadeMs =
    input.joinFadeMs === undefined ? 0 : number(input.joinFadeMs, "Join fade");
  if (joinFadeMs < 0 || joinFadeMs > 100)
    throw new Error("Join fade must be between 0 and 100 milliseconds.");
  const jointDefaults =
    input.jointDefaults === undefined
      ? { ...DEFAULT_JOINT_SETTINGS }
      : (checkedJoint(input.jointDefaults) as JointSettings);
  const jointOverrides: Record<string, Partial<JointSettings>> = {};
  if (input.jointOverrides !== undefined) {
    const overrides = object(input.jointOverrides, "Joint overrides");
    if (Object.keys(overrides).length > MAX_GROUPS * 2)
      throw new Error("The project contains too many joint overrides.");
    for (const [key, value] of Object.entries(overrides)) {
      let pair: unknown;
      try {
        pair = JSON.parse(key);
      } catch {
        throw new Error("A joint override has an invalid sentence pair.");
      }
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair[0] === pair[1] ||
        pair.some((id) => typeof id !== "string" || !groupMap.has(id)) ||
        key !== jointKey(pair[0], pair[1])
      )
        throw new Error("A joint override refers to an invalid sentence pair.");
      jointOverrides[key] = checkedJoint(value, true);
    }
  }
  let codex = { ...DEFAULT_CODEX_SELECTION };
  if (input.codex !== undefined) {
    const choice = object(input.codex, "Codex selection");
    if (typeof choice.fast !== "boolean")
      throw new Error("Codex Fast mode must be a boolean.");
    codex = {
      model: string(choice.model, "Codex model", 200, true),
      reasoning: string(choice.reasoning, "Codex reasoning effort", 200, true),
      fast: choice.fast,
    };
  }
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
    joinFadeMs: 0,
    audioSchema: 2,
    jointDefaults,
    jointOverrides,
    codex,
    updatedAt,
    ...(input.soundMix !== undefined
      ? { soundMix: parseSoundMix(input.soundMix, tracks) }
      : {}),
  };
}
