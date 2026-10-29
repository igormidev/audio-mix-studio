import type {
  AudioRole,
  AudioTrack,
  FadeCurve,
  MixClipSettings,
  MixKeyframe,
  MixLane,
  MixPlacement,
  MixProject,
  MixRenderClip,
  SoundMix,
} from "../shared/types";
import { appendTracks, masterClips } from "./project";

const SAMPLE_RATE = 48_000;
const MAX_TIME = 7 * 24 * 60 * 60;
const MAX_LANES = 64;
const MAX_PLACEMENTS = 5_000;
const MAX_KEYFRAMES = 1_000;
const curves: FadeCurve[] = [
  "linear",
  "ease-in",
  "ease-out",
  "s-curve",
  "custom",
];
const roles: AudioRole[] = ["voiceover", "music", "soundtrack"];
const sampleTime = (value: number) =>
  Math.round(value * SAMPLE_RATE) / SAMPLE_RATE;
const makeId = (prefix: string) =>
  `${prefix}-${globalThis.crypto.randomUUID()}`;
const changed = (project: MixProject, mix: SoundMix): MixProject => ({
  ...project,
  soundMix: mix,
  updatedAt: new Date().toISOString(),
});

export function defaultMixSettings(): MixClipSettings {
  return {
    speed: 1,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    fadeInStartMs: 0,
    fadeOutStartMs: 0,
    fadeInCurve: "linear",
    fadeOutCurve: "linear",
    fadeInPower: 2,
    fadeOutPower: 2,
  };
}

/** Missing mix data is an empty three-lane workspace, without modifying old projects. */
export function soundMix(project: MixProject): SoundMix {
  return (
    project.soundMix ?? {
      lanes: [
        { id: "voiceover", name: "Voiceover", kind: "voiceover" },
        { id: "music-1", name: "Music 1", kind: "music" },
        { id: "soundtrack-1", name: "Soundtrack 1", kind: "soundtrack" },
      ],
      placements: [],
    }
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${label} must be a nonempty string of at most ${max} characters.`,
    );
  return value;
}
function bounded(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} must be an array of at most ${max} items.`);
  return value;
}
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate IDs.`);
}
export function validAudioRole(value: unknown): AudioRole {
  if (!roles.includes(value as AudioRole))
    throw new Error("Invalid audio type.");
  return value as AudioRole;
}
export function validPlaybackSpeed(value: unknown, max = 2.5): number {
  const speed = bounded(value, "Audio speed", 0.5, max);
  if (Math.abs(speed * 100 - Math.round(speed * 100)) > 0.000001)
    throw new Error("Audio speed must use 1% steps.");
  return speed;
}
export function parseMixSettings(value: unknown): MixClipSettings {
  const input = record(value, "Clip settings");
  const curve = (key: "fadeInCurve" | "fadeOutCurve"): FadeCurve => {
    if (!curves.includes(input[key] as FadeCurve))
      throw new Error("Invalid fade curve.");
    return input[key] as FadeCurve;
  };
  return {
    speed: validPlaybackSpeed(input.speed, 2),
    volume: bounded(input.volume, "Clip volume", 0, 2),
    fadeInMs: bounded(input.fadeInMs, "Fade-in duration", 0, MAX_TIME * 1000),
    fadeOutMs: bounded(
      input.fadeOutMs,
      "Fade-out duration",
      0,
      MAX_TIME * 1000,
    ),
    fadeInStartMs: bounded(
      input.fadeInStartMs,
      "Fade-in start",
      0,
      MAX_TIME * 1000,
    ),
    fadeOutStartMs: bounded(
      input.fadeOutStartMs,
      "Fade-out end offset",
      0,
      MAX_TIME * 1000,
    ),
    fadeInCurve: curve("fadeInCurve"),
    fadeOutCurve: curve("fadeOutCurve"),
    fadeInPower: bounded(input.fadeInPower, "Fade-in shape", 0.1, 8),
    fadeOutPower: bounded(input.fadeOutPower, "Fade-out shape", 0.1, 8),
  };
}

/** Only validated source IDs enter a render plan; mix placements never become narration groups. */
export function parseSoundMix(value: unknown, tracks: AudioTrack[]): SoundMix {
  const input = record(value, "Sound mix");
  const lanes = list(input.lanes, "Mix tracks", MAX_LANES).map(
    (value): MixLane => {
      const lane = record(value, "Mix track");
      return {
        id: text(lane.id, "Mix track ID"),
        name: text(lane.name, "Mix track name", 1000),
        kind: validAudioRole(lane.kind),
      };
    },
  );
  unique(
    lanes.map((lane) => lane.id),
    "Mix tracks",
  );
  if (lanes.filter((lane) => lane.kind === "voiceover").length !== 1)
    throw new Error("The mix must contain exactly one voiceover track.");
  const laneMap = new Map(lanes.map((lane) => [lane.id, lane]));
  const sourceMap = new Map(tracks.map((track) => [track.id, track]));
  let keyframeCount = 0;
  const placements = list(input.placements, "Mix clips", MAX_PLACEMENTS).map(
    (value): MixPlacement => {
      const clip = record(value, "Mix clip");
      const laneId = text(clip.laneId, "Mix clip track ID");
      const lane = laneMap.get(laneId);
      if (!lane || lane.kind === "voiceover")
        throw new Error("A music clip refers to an invalid mix track.");
      const trackId = text(clip.trackId, "Mix clip source ID");
      const source = sourceMap.get(trackId);
      if (!source || (source.role ?? "voiceover") !== lane.kind)
        throw new Error(
          "A mix clip must use a source with the same audio type as its track.",
        );
      // FFprobe reports duration with six decimals. Validate against its actual
      // sample boundary so repeatedly saving a rounded endpoint stays valid.
      const sourceEnd = sampleTime(source.duration);
      const start = sampleTime(
        bounded(
          clip.start,
          "Mix clip source start",
          0,
          source.duration + 1 / SAMPLE_RATE,
        ),
      );
      const end = sampleTime(
        bounded(
          clip.end,
          "Mix clip source end",
          0,
          source.duration + 1 / SAMPLE_RATE,
        ),
      );
      if (start > sourceEnd || end > sourceEnd)
        throw new Error(
          "Mix clip boundaries must stay within the source audio.",
        );
      if (Math.round(end * SAMPLE_RATE) <= Math.round(start * SAMPLE_RATE))
        throw new Error("A mix clip must contain at least one source sample.");
      const keyframes = list(
        clip.keyframes,
        "Clip keyframes",
        MAX_KEYFRAMES,
      ).map((value): MixKeyframe => {
        const keyframe = record(value, "Keyframe");
        const time = bounded(
          keyframe.time,
          "Keyframe source time",
          0,
          end - start,
        );
        const frame = Math.round(time * SAMPLE_RATE);
        if (frame < 1 || frame >= Math.round((end - start) * SAMPLE_RATE))
          throw new Error("A keyframe must be inside its source clip.");
        return {
          id: text(keyframe.id, "Keyframe ID"),
          time: sampleTime(time),
          settings: parseMixSettings(keyframe.settings),
        };
      });
      keyframeCount += keyframes.length;
      if (keyframeCount > 5000)
        throw new Error("This mix contains too many keyframes.");
      unique(
        keyframes.map((keyframe) => keyframe.id),
        "Clip keyframes",
      );
      for (let index = 1; index < keyframes.length; index++)
        if (keyframes[index].time <= keyframes[index - 1].time)
          throw new Error("Keyframe source times must be strictly increasing.");
      const placement: MixPlacement = {
        id: text(clip.id, "Mix clip ID"),
        laneId,
        trackId,
        start: sampleTime(start),
        end: sampleTime(end),
        offset: sampleTime(
          bounded(clip.offset, "Mix clip timeline position", 0, MAX_TIME),
        ),
        settings: parseMixSettings(clip.settings),
        keyframes,
      };
      if (
        placement.offset +
          placementDuration({ tracks } as MixProject, placement) >
        MAX_TIME
      )
        throw new Error("The mix clip extends beyond the supported timeline.");
      return placement;
    },
  );
  unique(
    placements.map((clip) => clip.id),
    "Mix clips",
  );
  return { lanes, placements };
}

function withMix(project: MixProject, mix: SoundMix): MixProject {
  return changed(project, parseSoundMix(mix, project.tracks));
}

export function appendLibraryTracks(
  project: MixProject,
  incoming: AudioTrack[],
  role: AudioRole,
): MixProject {
  validAudioRole(role);
  if (!incoming.length) return project;
  const typed = incoming.map((track) => ({ ...track, role }));
  if (role === "voiceover") return appendTracks(project, typed);
  if (
    !project.tracks.some((track) => (track.role ?? "voiceover") === "voiceover")
  )
    throw new Error("Import a voiceover before adding music or sound effects.");
  // Reuse the source validator and source-count checks, then deliberately omit its temporary groups.
  const validated = appendTracks(project, typed);
  return {
    ...project,
    tracks: validated.tracks,
    updatedAt: validated.updatedAt,
  };
}

export function addMixLane(
  project: MixProject,
  kind: "music" | "soundtrack",
): MixProject {
  if (kind !== "music" && kind !== "soundtrack")
    throw new Error("Choose a music or soundtrack track.");
  const mix = soundMix(project);
  const prefix = kind === "music" ? "Music" : "Soundtrack";
  let number = 1;
  while (mix.lanes.some((lane) => lane.name === `${prefix} ${number}`))
    number++;
  return withMix(project, {
    ...mix,
    lanes: [
      ...mix.lanes,
      { id: makeId(kind), kind, name: `${prefix} ${number}` },
    ],
  });
}
export function removeMixLane(project: MixProject, laneId: string): MixProject {
  const mix = soundMix(project);
  const lane = mix.lanes.find((lane) => lane.id === laneId);
  if (!lane) return project;
  if (lane.kind === "voiceover")
    throw new Error("The voiceover reference track cannot be deleted.");
  return withMix(project, {
    lanes: mix.lanes.filter((lane) => lane.id !== laneId),
    placements: mix.placements.filter((clip) => clip.laneId !== laneId),
  });
}
export function moveMixLane(
  project: MixProject,
  laneId: string,
  target: number | string,
): MixProject {
  const mix = soundMix(project);
  const from = mix.lanes.findIndex((lane) => lane.id === laneId);
  const to =
    typeof target === "string"
      ? mix.lanes.findIndex((lane) => lane.id === target)
      : target;
  if (
    from < 0 ||
    !Number.isInteger(to) ||
    to < 0 ||
    to >= mix.lanes.length ||
    from === to
  )
    return project;
  const lanes = [...mix.lanes];
  const [lane] = lanes.splice(from, 1);
  lanes.splice(to, 0, lane);
  return withMix(project, { ...mix, lanes });
}
export function addMixPlacement(
  project: MixProject,
  laneId: string,
  trackId: string,
  offset = 0,
): MixProject {
  const source = project.tracks.find((track) => track.id === trackId);
  if (!source) throw new Error("That source audio no longer exists.");
  const mix = soundMix(project);
  return withMix(project, {
    ...mix,
    placements: [
      ...mix.placements,
      {
        id: makeId("clip"),
        laneId,
        trackId,
        start: 0,
        end: source.duration,
        offset,
        settings: defaultMixSettings(),
        keyframes: [],
      },
    ],
  });
}
export function updateMixPlacement(
  project: MixProject,
  placementId: string,
  patch: Partial<Omit<MixPlacement, "id">>,
): MixProject {
  const mix = soundMix(project);
  if (!mix.placements.some((clip) => clip.id === placementId))
    throw new Error("That timeline clip no longer exists.");
  return withMix(project, {
    ...mix,
    placements: mix.placements.map((clip) =>
      clip.id === placementId ? { ...clip, ...patch } : clip,
    ),
  });
}
export function removeMixPlacement(
  project: MixProject,
  placementId: string,
): MixProject {
  const mix = soundMix(project);
  return withMix(project, {
    ...mix,
    placements: mix.placements.filter((clip) => clip.id !== placementId),
  });
}

export function placementRenderClips(
  _project: MixProject,
  placement: MixPlacement,
): MixRenderClip[] {
  let offset = placement.offset;
  const points = [
    { id: placement.id, time: 0, settings: placement.settings },
    ...placement.keyframes,
  ];
  return points.flatMap((point, index) => {
    const start = sampleTime(placement.start + point.time);
    const end = sampleTime(
      placement.start +
        (points[index + 1]?.time ?? placement.end - placement.start),
    );
    const sourceFrames =
      Math.round(end * SAMPLE_RATE) - Math.round(start * SAMPLE_RATE);
    const duration =
      Math.round(sourceFrames / point.settings.speed) / SAMPLE_RATE;
    const clip: MixRenderClip = {
      ...point.settings,
      id: `${placement.id}:${point.id}`,
      trackId: placement.trackId,
      groupId: placement.id,
      text: "",
      enabled: true,
      start,
      end,
      offset,
      duration,
      sourceDuration: sourceFrames / SAMPLE_RATE,
    };
    offset = sampleTime(offset + duration);
    return duration > 0 ? [clip] : [];
  });
}
export function placementDuration(
  project: MixProject,
  placement: MixPlacement,
): number {
  return sampleTime(
    placementRenderClips(project, placement).reduce(
      (duration, clip) => duration + clip.duration,
      0,
    ),
  );
}
export function sourceTimeAtPlacement(
  project: MixProject,
  placement: MixPlacement,
  outputRelativeTime: number,
): number {
  if (!Number.isFinite(outputRelativeTime))
    throw new Error("Invalid timeline time.");
  const at = Math.max(0, outputRelativeTime);
  const clips = placementRenderClips(project, placement);
  for (const clip of clips) {
    const relativeOffset = clip.offset - placement.offset;
    if (at < relativeOffset + clip.duration)
      return sampleTime(
        Math.min(
          placement.end - placement.start,
          clip.start -
            placement.start +
            Math.max(0, at - relativeOffset) * (clip.speed ?? 1),
        ),
      );
  }
  return placement.end - placement.start;
}
export function outputTimeAtPlacement(
  project: MixProject,
  placement: MixPlacement,
  sourceRelativeTime: number,
): number {
  if (!Number.isFinite(sourceRelativeTime))
    throw new Error("Invalid source time.");
  const at = Math.max(
    0,
    Math.min(placement.end - placement.start, sourceRelativeTime),
  );
  const clips = placementRenderClips(project, placement);
  for (const clip of clips) {
    const relativeStart = clip.start - placement.start;
    if (at <= clip.end - placement.start)
      return sampleTime(
        clip.offset -
          placement.offset +
          Math.max(0, at - relativeStart) / (clip.speed ?? 1),
      );
  }
  return placementDuration(project, placement);
}
export function mixRenderClips(project: MixProject): MixRenderClip[] {
  return [
    ...masterClips(project),
    ...soundMix(project).placements.flatMap((placement) =>
      placementRenderClips(project, placement),
    ),
  ].sort((a, b) => a.offset - b.offset);
}
export function mixDuration(project: MixProject): number {
  return mixRenderClips(project).reduce(
    (end, clip) => Math.max(end, clip.offset + clip.duration),
    0,
  );
}
export function addMixKeyframe(
  project: MixProject,
  placementId: string,
  sourceTime: number,
): MixProject {
  const placement = soundMix(project).placements.find(
    (clip) => clip.id === placementId,
  );
  if (!placement) throw new Error("That timeline clip no longer exists.");
  const time = sampleTime(sourceTime);
  if (
    !Number.isFinite(time) ||
    time <= 0 ||
    time >= placement.end - placement.start
  )
    throw new Error("Place the cursor inside the clip to add a keyframe.");
  if (
    placement.keyframes.some(
      (keyframe) => Math.abs(keyframe.time - time) < 1 / SAMPLE_RATE,
    )
  )
    return project;
  const previous = [...placement.keyframes]
    .reverse()
    .find((keyframe) => keyframe.time < time);
  return updateMixPlacement(project, placementId, {
    keyframes: [
      ...placement.keyframes,
      {
        id: makeId("keyframe"),
        time,
        settings: { ...(previous?.settings ?? placement.settings) },
      },
    ].sort((a, b) => a.time - b.time),
  });
}
export function updateMixKeyframe(
  project: MixProject,
  placementId: string,
  keyframeId: string,
  patch: Partial<Omit<MixKeyframe, "id">>,
): MixProject {
  const placement = soundMix(project).placements.find(
    (clip) => clip.id === placementId,
  );
  if (
    !placement ||
    !placement.keyframes.some((keyframe) => keyframe.id === keyframeId)
  )
    throw new Error("That keyframe no longer exists.");
  return updateMixPlacement(project, placementId, {
    keyframes: placement.keyframes
      .map((keyframe) =>
        keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe,
      )
      .sort((a, b) => a.time - b.time),
  });
}
export function removeMixKeyframe(
  project: MixProject,
  placementId: string,
  keyframeId: string,
): MixProject {
  const placement = soundMix(project).placements.find(
    (clip) => clip.id === placementId,
  );
  if (!placement) throw new Error("That timeline clip no longer exists.");
  return updateMixPlacement(project, placementId, {
    keyframes: placement.keyframes.filter(
      (keyframe) => keyframe.id !== keyframeId,
    ),
  });
}
