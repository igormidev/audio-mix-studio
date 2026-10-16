import { describe, expect, it } from "vitest";
import type {
  AlignmentResult,
  AudioTrack,
  MixProject,
} from "../src/shared/types";
import {
  ALIGNMENT_PADDING_SECONDS,
  alignmentSchema,
  appendTracks,
  applyAlignment,
  chooseVariation,
  masterClips,
  masterDuration,
  moveGroup,
  newProject,
  parseProject,
  removeTrack,
  splitSegment,
  toggleSegment,
  trimSegment,
} from "../src/domain/project";

function track(id: string, duration = 10): AudioTrack {
  return {
    id,
    name: `Take ${id}`,
    duration,
    color: "#4c8dba",
    peaks: [0, 0.1, 1],
    mediaUrl: `mixmedia://audio/${id}`,
  };
}

function project(): MixProject {
  return appendTracks(newProject(), [track("a"), track("b"), track("c")]);
}

const alignment: AlignmentResult = {
  groups: [
    {
      text: "First sentence.",
      note: "",
      variations: [
        { trackId: "b", start: 0, end: 2, text: "First sentence." },
        { trackId: "a", start: 0, end: 2, text: "First sentence." },
      ],
    },
    {
      text: "Extra context.",
      note: "Only in take C.",
      variations: [{ trackId: "c", start: 2, end: 3, text: "Extra context." }],
    },
    {
      text: "Last sentence.",
      note: "",
      variations: [
        { trackId: "a", start: 4, end: 6, text: "Last sentence." },
        { trackId: "b", start: 5, end: 7, text: "Last sentence." },
      ],
    },
  ],
};

describe("master editing", () => {
  it("defaults to large-v3-turbo and adds valid manual source selections immutably", () => {
    const empty = newProject();
    const imported = appendTracks(empty, [track("a")]);
    expect(empty.tracks).toHaveLength(0);
    expect(imported.model).toBe("large-v3-turbo");
    expect(masterDuration(imported)).toBe(10);
    expect(() => appendTracks(imported, [track("a")])).toThrow(/repeated/);
  });

  it("orders by sentence group, selects source import order, and retains missing-take groups", () => {
    const mixed = applyAlignment(project(), alignment);
    const clips = masterClips(mixed);
    expect(clips.map((clip) => clip.trackId)).toEqual(["a", "c", "a"]);
    expect(mixed.groups[1].segmentIds).toHaveLength(1);
    expect(clips[1].offset).toBeCloseTo(clips[0].duration);
    expect(clips[2].offset).toBeCloseTo(clips[0].duration + clips[1].duration);
    expect(masterDuration(mixed)).toBeCloseTo(
      clips.reduce((total, clip) => total + clip.duration, 0),
    );
    const moved = moveGroup(mixed, mixed.groups[2].id, -1);
    expect(masterClips(moved).map((clip) => clip.text)).toEqual([
      "First sentence.",
      "Last sentence.",
      "Extra context.",
    ]);
  });

  it("selects every split piece of a take and permits explicit multiple active takes", () => {
    let mixed = applyAlignment(project(), alignment);
    const group = mixed.groups[0];
    const b = mixed.segments.find(
      (segment) => segment.groupId === group.id && segment.trackId === "b",
    )!;
    mixed = splitSegment(mixed, b.id, 1);
    mixed = chooseVariation(mixed, group.id, "b");
    expect(
      mixed.segments.filter(
        (segment) => segment.groupId === group.id && segment.enabled,
      ),
    ).toHaveLength(2);
    expect(
      masterClips(mixed)
        .slice(0, 2)
        .map((clip) => clip.start),
    ).toEqual([0, 1]);
    const a = mixed.segments.find(
      (segment) => segment.groupId === group.id && segment.trackId === "a",
    )!;
    mixed = toggleSegment(mixed, a.id);
    expect(
      mixed.segments.filter(
        (segment) => segment.groupId === group.id && segment.enabled,
      ),
    ).toHaveLength(3);
    expect(
      masterClips(mixed)
        .slice(0, 3)
        .map((clip) => clip.trackId),
    ).toEqual(["a", "b", "b"]);
  });

  it("keeps source order after repeated splits and rejects cuts at or beyond boundaries", () => {
    let mixed = appendTracks(newProject(), [track("a")]);
    const original = mixed.segments[0];
    mixed = splitSegment(mixed, original.id, 8);
    mixed = splitSegment(mixed, original.id, 3);
    expect(
      masterClips(mixed).map((clip) => [clip.start, clip.end, clip.offset]),
    ).toEqual([
      [0, 3, 0],
      [3, 8, 3],
      [8, 10, 8],
    ]);
    expect(() => splitSegment(mixed, original.id, 0)).toThrow(/inside/);
    expect(() => splitSegment(mixed, original.id, 3)).toThrow(/inside/);
    expect(() => splitSegment(mixed, original.id, Number.NaN)).toThrow(
      /inside/,
    );
  });

  it("trims without editing the source and prevents overlapping existing pieces", () => {
    let mixed = appendTracks(newProject(), [track("a")]);
    const original = mixed.segments[0];
    mixed = splitSegment(mixed, original.id, 5);
    const trimmed = trimSegment(mixed, original.id, 1, 4);
    expect(trimmed.tracks[0].duration).toBe(10);
    expect(mixed.segments[0].start).toBe(0);
    expect(masterDuration(trimmed)).toBe(8);
    expect(() => trimSegment(mixed, original.id, 1, 6)).toThrow(/overlap/);
    expect(() => trimSegment(mixed, original.id, -1, 4)).toThrow(/within/);
    expect(() => trimSegment(mixed, original.id, 3, 3)).toThrow(/before/);
  });

  it("removes orphan groups and chooses a fallback when removing a selected take", () => {
    const mixed = applyAlignment(project(), alignment);
    const removed = removeTrack(mixed, "a");
    expect(masterClips(removed).map((clip) => clip.trackId)).toEqual([
      "b",
      "c",
      "b",
    ]);
    expect(removed.segments.every((segment) => segment.trackId !== "a")).toBe(
      true,
    );
    const missing = removeTrack(removed, "c");
    expect(missing.groups.map((group) => group.text)).toEqual([
      "First sentence.",
      "Last sentence.",
    ]);
    expect(parseProject(missing)).toEqual(missing);
  });
});

describe("alignment contract", () => {
  it("pads speech boundaries by 60 ms and clamps short gaps at their midpoint", () => {
    const p = appendTracks(newProject(), [track("a")]);
    const output = applyAlignment(p, {
      groups: [
        {
          text: "A",
          note: "",
          variations: [{ trackId: "a", start: 1, end: 2, text: "A" }],
        },
        {
          text: "B",
          note: "",
          variations: [{ trackId: "a", start: 2.04, end: 3, text: "B" }],
        },
        {
          text: "C",
          note: "",
          variations: [{ trackId: "a", start: 5, end: 10, text: "C" }],
        },
      ],
    });
    expect(output.segments[0].start).toBeCloseTo(1 - ALIGNMENT_PADDING_SECONDS);
    expect(output.segments[0].end).toBeCloseTo(2.02);
    expect(output.segments[1].start).toBeCloseTo(2.02);
    expect(output.segments[1].end).toBeCloseTo(3.06);
    expect(output.segments[2].end).toBe(10);
    expect(parseProject(output)).toEqual(output);
  });

  it("preserves selected takes and muted groups when a sentence label matches again", () => {
    let mixed = applyAlignment(project(), alignment);
    mixed = chooseVariation(mixed, mixed.groups[0].id, "b");
    mixed = toggleSegment(mixed, mixed.groups[1].segmentIds[0]);
    const regrouped = applyAlignment(mixed, alignment);
    expect(masterClips(regrouped).map((clip) => clip.trackId)).toEqual([
      "b",
      "a",
    ]);
  });

  it.each([
    [{ groups: [] }, /any sentences/],
    [{ groups: [{ text: "A", note: "", variations: [] }] }, /no source/],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [{ trackId: "missing", start: 0, end: 2, text: "A" }],
          },
        ],
      },
      /unknown track/,
    ],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [
              { trackId: "a", start: Number.NaN, end: 2, text: "A" },
            ],
          },
        ],
      },
      /finite/,
    ],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [{ trackId: "a", start: 0, end: 11, text: "A" }],
          },
        ],
      },
      /within/,
    ],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [{ trackId: "a", start: 2, end: 1, text: "A" }],
          },
        ],
      },
      /before/,
    ],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [
              { trackId: "a", start: 0, end: 2, text: "A" },
              { trackId: "a", start: 3, end: 4, text: "A" },
            ],
          },
        ],
      },
      /two variations/,
    ],
    [
      {
        groups: [
          {
            text: "A",
            note: "",
            variations: [{ trackId: "a", start: 0, end: 2, text: "A" }],
          },
          {
            text: "B",
            note: "",
            variations: [{ trackId: "a", start: 1, end: 3, text: "B" }],
          },
        ],
      },
      /overlap/,
    ],
    [{ groups: [], injected: true }, /unexpected/],
  ])(
    "rejects invalid AI output %# without changing project",
    (invalid, message) => {
      const source = project();
      const before = JSON.stringify(source);
      expect(() => applyAlignment(source, invalid)).toThrow(message);
      expect(JSON.stringify(source)).toBe(before);
    },
  );

  it("marks every schema object strict with all of its fields required", () => {
    function inspect(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const entry = value as Record<string, unknown>;
      if (entry.type === "object") {
        expect(entry.additionalProperties).toBe(false);
        expect(new Set(entry.required as string[])).toEqual(
          new Set(Object.keys(entry.properties as object)),
        );
      }
      Object.values(entry).forEach(inspect);
    }
    inspect(alignmentSchema);
  });
});

describe("saved project validation", () => {
  it("round-trips real edits and drops unrecognized persisted fields", () => {
    const mixed = applyAlignment(project(), alignment);
    const parsed = parseProject({ ...mixed, untrusted: "__proto__" });
    expect(parsed).toEqual(mixed);
    expect(parsed).not.toBe(mixed);
    expect(parsed.tracks).not.toBe(mixed.tracks);
  });

  it.each([
    (p: MixProject) => ({ ...p, version: 2 }),
    (p: MixProject) => ({ ...p, model: "untrusted-model" }),
    (p: MixProject) => ({ ...p, joinFadeMs: Number.POSITIVE_INFINITY }),
    (p: MixProject) => ({ ...p, tracks: [...p.tracks, p.tracks[0]] }),
    (p: MixProject) => ({
      ...p,
      segments: p.segments.map((segment, index) =>
        index ? segment : { ...segment, end: -1 },
      ),
    }),
    (p: MixProject) => ({
      ...p,
      segments: p.segments.map((segment, index) =>
        index ? segment : { ...segment, trackId: "missing" },
      ),
    }),
    (p: MixProject) => ({
      ...p,
      groups: p.groups.map((group, index) =>
        index ? group : { ...group, segmentIds: ["missing"] },
      ),
    }),
    (p: MixProject) => ({
      ...p,
      segments: p.segments.map((segment, index) =>
        index ? segment : { ...segment, enabled: "yes" },
      ),
    }),
    (p: MixProject) => ({ ...p, updatedAt: "not a date" }),
    (p: MixProject) => ({
      ...p,
      tracks: p.tracks.map((track, index) =>
        index ? track : { ...track, peaks: [2] },
      ),
    }),
  ])("rejects corrupted project %#", (mutate) => {
    expect(() =>
      parseProject(mutate(applyAlignment(project(), alignment))),
    ).toThrow();
  });

  it("rejects a segment referenced under the wrong sentence and hidden overlapping audio", () => {
    const p = applyAlignment(project(), alignment);
    expect(() =>
      parseProject({
        ...p,
        groups: p.groups.map((group, index) =>
          index === 0
            ? {
                ...group,
                segmentIds: [...group.segmentIds, p.groups[1].segmentIds[0]],
              }
            : group,
        ),
      }),
    ).toThrow(/inconsistent/);
    expect(() =>
      parseProject({
        ...p,
        segments: p.segments.map((segment) =>
          segment.groupId === p.groups[2].id && segment.trackId === "a"
            ? { ...segment, start: 1 }
            : segment,
        ),
      }),
    ).toThrow(/overlap/);
  });
});
