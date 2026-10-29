import { describe, expect, it } from "vitest";
import type { AudioTrack, MixProject } from "../src/shared/types";
import {
  appendTracks,
  applyAlignment,
  masterClips,
  newProject,
  parseProject,
  removeTrack,
  setGroupSpeed,
} from "../src/domain/project";
import {
  addMixKeyframe,
  addMixLane,
  addMixPlacement,
  appendLibraryTracks,
  defaultMixSettings,
  mixDuration,
  mixRenderClips,
  moveMixLane,
  outputTimeAtPlacement,
  placementDuration,
  placementRenderClips,
  removeMixKeyframe,
  removeMixLane,
  soundMix,
  sourceTimeAtPlacement,
  updateMixKeyframe,
  updateMixPlacement,
} from "../src/domain/soundMix";
import { initialEditor, editorReducer } from "../src/ui/editor";

const track = (id: string, duration = 10): AudioTrack => ({
  id,
  name: id,
  duration,
  color: "#4c8dba",
  peaks: [0.1, 0.5, 1],
  mediaUrl: `mixmedia://audio/${id}`,
});
function project(): MixProject {
  let project = appendTracks(newProject(), [track("narration")]);
  project = appendLibraryTracks(project, [track("music", 20)], "music");
  return appendLibraryTracks(project, [track("fx", 3)], "soundtrack");
}
function placed() {
  return addMixPlacement(project(), "music-1", "music", 2);
}

describe("sound mix source roles and tracks", () => {
  it("keeps music and effects out of narration ordering and retains them through alignment", () => {
    const source = project();
    expect(source.groups).toHaveLength(1);
    expect(masterClips(source).map((clip) => clip.trackId)).toEqual([
      "narration",
    ]);
    const aligned = applyAlignment(source, {
      groups: [
        {
          text: "Hello.",
          note: "",
          variations: [
            { trackId: "narration", start: 1, end: 2, text: "Hello." },
          ],
        },
      ],
    });
    expect(aligned.tracks).toHaveLength(3);
    expect(masterClips(aligned)[0].duration).toBe(10);
    expect(() =>
      applyAlignment(source, {
        groups: [
          {
            text: "Music",
            note: "",
            variations: [{ trackId: "music", start: 1, end: 2, text: "Music" }],
          },
        ],
      }),
    ).toThrow(/unknown track/);
    expect(() =>
      appendLibraryTracks(newProject(), [track("music")], "music"),
    ).toThrow(/voiceover/);
  });
  it("starts with three reorderable tracks, only one protected voiceover, and deletes clips with their lane", () => {
    let source = placed();
    const original = soundMix(source);
    expect(original.lanes.map((lane) => lane.kind)).toEqual([
      "voiceover",
      "music",
      "soundtrack",
    ]);
    source = addMixLane(source, "music");
    const last = soundMix(source).lanes.at(-1)!;
    expect(last.name).toBe("Music 2");
    source = moveMixLane(source, last.id, "voiceover");
    expect(soundMix(source).lanes[0].id).toBe(last.id);
    expect(() => removeMixLane(source, "voiceover")).toThrow(
      /cannot be deleted/,
    );
    source = removeMixLane(source, "music-1");
    expect(soundMix(source).placements).toHaveLength(0);
    expect(original.placements).toHaveLength(1);
    expect(parseProject(source)).toEqual(source);
  });
  it("removes placements for a deleted source without changing unrelated audio", () => {
    let source = placed();
    source = addMixPlacement(source, "soundtrack-1", "fx", 6);
    const removed = removeTrack(source, "music");
    expect(soundMix(removed).placements.map((clip) => clip.trackId)).toEqual([
      "fx",
    ]);
    expect(masterClips(removed)).toEqual(masterClips(source));
    expect(parseProject(removed)).toEqual(removed);
  });
});

describe("piecewise keyframe source and output clocks", () => {
  it("applies settings between keyframes and keeps later audio synchronized when speed changes", () => {
    let source = placed();
    const id = soundMix(source).placements[0].id;
    source = addMixKeyframe(source, id, 4);
    source = addMixKeyframe(source, id, 10);
    const [a, b] = soundMix(source).placements[0].keyframes;
    source = updateMixKeyframe(source, id, a.id, {
      settings: {
        ...a.settings,
        speed: 2,
        volume: 0.3,
        fadeInMs: 500,
        fadeInCurve: "s-curve",
      },
    });
    source = updateMixKeyframe(source, id, b.id, {
      settings: { ...b.settings, speed: 0.5 },
    });
    const clip = soundMix(source).placements[0];
    expect(
      placementRenderClips(source, clip).map((clip) => [
        clip.start,
        clip.end,
        clip.offset,
        clip.duration,
        clip.volume,
      ]),
    ).toEqual([
      [0, 4, 2, 4, 1],
      [4, 10, 6, 3, 0.3],
      [10, 20, 9, 20, 1],
    ]);
    expect(placementDuration(source, clip)).toBe(27);
    expect(mixDuration(source)).toBe(29);
    expect(sourceTimeAtPlacement(source, clip, 5)).toBe(6);
    expect(outputTimeAtPlacement(source, clip, 6)).toBe(5);
    expect(sourceTimeAtPlacement(source, clip, 1000)).toBe(20);
    expect(outputTimeAtPlacement(source, clip, 1000)).toBe(27);
    source = removeMixKeyframe(source, id, a.id);
    expect(placementDuration(source, soundMix(source).placements[0])).toBe(30);
    expect(parseProject(source)).toEqual(source);
  });
  it("round-trips rounded FFprobe durations and refuses nonfinite time conversions", () => {
    let source = appendTracks(newProject(), [track("voice")]);
    source = appendLibraryTracks(
      source,
      [track("short-music", 0.333333)],
      "music",
    );
    source = addMixPlacement(source, "music-1", "short-music");
    const clip = soundMix(source).placements[0];
    expect(clip.end).toBe(16000 / 48000);
    expect(parseProject(parseProject(source))).toEqual(source);
    expect(() => sourceTimeAtPlacement(source, clip, Number.NaN)).toThrow(
      /time/,
    );
    expect(() =>
      outputTimeAtPlacement(source, clip, Number.POSITIVE_INFINITY),
    ).toThrow(/time/);
  });
  it("moves clips independently, supports overlaps, and exports the full mix duration", () => {
    let source = placed();
    source = addMixPlacement(source, "soundtrack-1", "fx", 5);
    const placement = soundMix(source).placements[0];
    source = updateMixPlacement(source, placement.id, {
      offset: 9,
      start: 1,
      end: 5,
      settings: { ...defaultMixSettings(), speed: 1.37 },
    });
    const plan = mixRenderClips(source);
    expect(plan.map((clip) => clip.offset)).toEqual([0, 5, 9]);
    expect(plan[2].duration).toBe(Math.round((4 * 48000) / 1.37) / 48000);
    expect(mixDuration(source)).toBeCloseTo(9 + 4 / 1.37, 4);
    expect(parseProject(source)).toEqual(source);
    expect(() => addMixPlacement(source, "music-1", "fx", 0)).toThrow(
      /same audio type/,
    );
  });
  it("snaps narration edits together at percent speed, retaining source silence", () => {
    let source = applyAlignment(project(), {
      groups: [
        {
          text: "A",
          note: "",
          variations: [{ trackId: "narration", start: 1, end: 2, text: "A" }],
        },
        {
          text: "B",
          note: "",
          variations: [{ trackId: "narration", start: 4, end: 5, text: "B" }],
        },
      ],
    });
    source = setGroupSpeed(source, source.groups[0].id, 1.01);
    const [a, b] = masterClips(source);
    expect(b.offset).toBe(a.duration);
    expect(a.end).toBe(b.start);
    expect(parseProject(source)).toEqual(source);
    expect(() => setGroupSpeed(source, source.groups[0].id, 1.001)).toThrow(
      /1%/,
    );
  });
  it("keeps lane placements and keyframes inside independent undo histories", () => {
    const initial = project();
    let editor = initialEditor(initial);
    editor = editorReducer(editor, {
      type: "edit",
      now: "2026-01-01T00:00:00.000Z",
      update: (project) => addMixPlacement(project, "music-1", "music", 2),
    });
    const id = soundMix(editor.project).placements[0].id;
    editor = editorReducer(editor, {
      type: "edit",
      now: "2026-01-01T00:00:01.000Z",
      update: (project) => addMixKeyframe(project, id, 5),
    });
    expect(soundMix(editor.project).placements[0].keyframes).toHaveLength(1);
    editor = editorReducer(editor, { type: "undo" });
    expect(soundMix(editor.project).placements[0].keyframes).toHaveLength(0);
    editor = editorReducer(editor, { type: "undo" });
    expect(editor.project).toEqual(initial);
    editor = editorReducer(editor, { type: "redo" });
    expect(soundMix(editor.project).placements).toHaveLength(1);
  });
});

describe("untrusted mix validation", () => {
  it("round-trips every setting and rejects corrupt JSON values, references, and keyframe order", () => {
    let source = placed();
    const id = soundMix(source).placements[0].id;
    source = addMixKeyframe(source, id, 5);
    const clip = soundMix(source).placements[0];
    source = updateMixPlacement(source, id, {
      settings: {
        ...defaultMixSettings(),
        speed: 1.01,
        volume: 0.42,
        fadeInMs: 1200,
        fadeInStartMs: 250,
        fadeOutMs: 1700,
        fadeOutStartMs: 400,
        fadeInCurve: "custom",
        fadeInPower: 3.1,
        fadeOutCurve: "ease-out",
        fadeOutPower: 1.2,
      },
    });
    expect(parseProject(JSON.parse(JSON.stringify(source)))).toEqual(source);
    const invalid = [
      { ...soundMix(source), lanes: [] },
      {
        ...soundMix(source),
        lanes: [
          ...soundMix(source).lanes,
          { id: "second-voice", name: "Voice", kind: "voiceover" },
        ],
      },
      { ...soundMix(source), placements: [{ ...clip, trackId: "missing" }] },
      { ...soundMix(source), placements: [{ ...clip, laneId: "voiceover" }] },
      { ...soundMix(source), placements: [{ ...clip, offset: -1 }] },
      { ...soundMix(source), placements: [{ ...clip, end: 21 }] },
      {
        ...soundMix(source),
        placements: [{ ...clip, settings: { ...clip.settings, speed: 2.01 } }],
      },
      {
        ...soundMix(source),
        placements: [
          { ...clip, settings: { ...clip.settings, volume: Number.NaN } },
        ],
      },
      {
        ...soundMix(source),
        placements: [
          { ...clip, settings: { ...clip.settings, fadeInCurve: "unknown" } },
        ],
      },
      {
        ...soundMix(source),
        placements: [
          { ...clip, keyframes: [{ ...clip.keyframes[0], time: 0 }] },
        ],
      },
      {
        ...soundMix(source),
        placements: [
          { ...clip, keyframes: [{ ...clip.keyframes[0], time: 20 }] },
        ],
      },
      {
        ...soundMix(source),
        placements: [
          {
            ...clip,
            keyframes: [
              clip.keyframes[0],
              { ...clip.keyframes[0], id: "second", time: 3 },
            ],
          },
        ],
      },
    ];
    for (const soundMix of invalid)
      expect(() => parseProject({ ...source, soundMix })).toThrow();
    expect(() =>
      parseProject({
        ...source,
        tracks: source.tracks.map((track) => ({ ...track, role: "invalid" })),
      }),
    ).toThrow(/audio type/);
    expect(() => addMixKeyframe(source, id, Number.NaN)).toThrow(/inside/);
  });
});
