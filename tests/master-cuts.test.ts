import { describe, expect, it } from "vitest";
import {
  appendSentenceAlternatives,
  appendTracks,
  applyAlignment,
  chooseVariation,
  excludeMasterRange,
  masterClips,
  masterDuration,
  masterTimelineClips,
  masterTimelineDuration,
  masterToTimelineTime,
  newProject,
  parseProject,
  restoreMasterSegment,
  setGroupSpeed,
  setJointDefaults,
  setJointOverride,
  timelineToMasterTime,
  toggleSegment,
  trimSegment,
} from "../src/domain/project";
import type { AudioTrack, MixProject } from "../src/shared/types";

function track(id = "a", duration = 10): AudioTrack {
  return {
    id,
    name: `${id}.wav`,
    duration,
    color: "#336699",
    peaks: [0, 1, 0],
    mediaUrl: `mixmedia://audio/${id}`,
  };
}

function project(): MixProject {
  return appendTracks(newProject(), [track()]);
}

function grouped(): MixProject {
  return applyAlignment(appendTracks(newProject(), [track("a", 12)]), {
    groups: [0, 1, 2].map((index) => ({
      text: `Sentence ${index + 1}.`,
      note: "",
      variations: [
        {
          trackId: "a",
          start: index * 4 + 1,
          end: index * 4 + 3,
          text: `Sentence ${index + 1}.`,
        },
      ],
    })),
  });
}

describe("reversible master range cuts", () => {
  it("retains gray source ranges while assembling gapless remaining audio", () => {
    const original = project();
    const before = JSON.stringify(original);
    const cut = excludeMasterRange(original, 2, 4);
    expect(JSON.stringify(original)).toBe(before);
    expect(
      cut.segments.map((segment) => [
        segment.start,
        segment.end,
        segment.enabled,
        !!segment.excluded,
      ]),
    ).toEqual([
      [0, 2, true, false],
      [2, 4, true, true],
      [4, 10, true, false],
    ]);
    expect(
      masterClips(cut).map((clip) => [clip.start, clip.end, clip.offset]),
    ).toEqual([
      [0, 2, 0],
      [4, 10, 2],
    ]);
    expect(masterDuration(cut)).toBe(8);
    expect(masterTimelineDuration(cut)).toBe(10);
    expect(
      masterTimelineClips(cut).map((clip) => [
        clip.offset,
        clip.duration,
        clip.playbackOffset,
      ]),
    ).toEqual([
      [0, 2, 0],
      [2, 2, 2],
      [4, 6, 2],
    ]);
    expect(cut.tracks).toBe(original.tracks);
    expect(parseProject(cut)).toEqual(cut);
  });

  it("jumps over cuts exactly at playback boundaries and seeks gray regions to that boundary", () => {
    const timeline = masterTimelineClips(excludeMasterRange(project(), 2, 4));
    expect(
      [0, 1, 2, 3, 8, 99].map((time) => masterToTimelineTime(timeline, time)),
    ).toEqual([0, 1, 4, 5, 10, 10]);
    expect(
      [0, 1, 2, 3, 4, 5, 10, 99].map((time) =>
        timelineToMasterTime(timeline, time),
      ),
    ).toEqual([0, 1, 2, 2, 2, 3, 8, 8]);
    expect(masterToTimelineTime(timeline, -2)).toBe(0);
    expect(timelineToMasterTime(timeline, -2)).toBe(0);
  });

  it("handles leading and trailing cuts without silent playback gaps", () => {
    const cut = excludeMasterRange(
      excludeMasterRange(project(), 0, 1.25),
      8.5,
      10,
    );
    expect(
      masterClips(cut).map((clip) => [clip.start, clip.end, clip.offset]),
    ).toEqual([[1.25, 8.5, 0]]);
    expect(masterDuration(cut)).toBe(7.25);
    expect(masterTimelineDuration(cut)).toBe(10);
    const timeline = masterTimelineClips(cut);
    expect(masterToTimelineTime(timeline, 0)).toBe(1.25);
    expect(masterToTimelineTime(timeline, 7.25)).toBe(10);
    expect(timelineToMasterTime(timeline, 0.5)).toBe(0);
    expect(timelineToMasterTime(timeline, 9)).toBe(7.25);
  });

  it("can cut and restore an entire assembly, including an all-gray cursor", () => {
    let cut = excludeMasterRange(project(), -100, 100);
    expect(masterClips(cut)).toEqual([]);
    expect(masterDuration(cut)).toBe(0);
    expect(masterTimelineDuration(cut)).toBe(10);
    expect(masterToTimelineTime(masterTimelineClips(cut), 0)).toBe(10);
    expect(timelineToMasterTime(masterTimelineClips(cut), 5)).toBe(0);
    cut = restoreMasterSegment(cut, cut.segments[0].id);
    expect(masterDuration(cut)).toBe(10);
    expect(cut.segments[0].enabled).toBe(true);
    expect(cut.segments[0].excluded).toBe(false);
    expect(masterToTimelineTime(masterTimelineClips(cut), 0)).toBe(0);
  });

  it("accepts reverse drags and makes no edit for existing cuts, pauses, or sub-sample selections", () => {
    const original = project();
    const cut = excludeMasterRange(original, 4, 2);
    expect(masterDuration(cut)).toBe(8);
    expect(excludeMasterRange(cut, 2.25, 3.75)).toBe(cut);
    expect(excludeMasterRange(cut, 2, 2)).toBe(cut);
    expect(excludeMasterRange(cut, 100, 200)).toBe(cut);
    expect(excludeMasterRange(original, 1, 1 + 0.1 / 48_000)).toBe(original);
    let paused = grouped();
    paused = setJointDefaults(paused, { pauseMs: 1000 });
    expect(excludeMasterRange(paused, 4.1, 4.9)).toBe(paused);
  });

  it("combines overlapping removals without removing audio twice and restores only the requested gray piece", () => {
    let cut = excludeMasterRange(project(), 2, 4);
    const firstCut = cut.segments.find((segment) => segment.excluded)!;
    cut = excludeMasterRange(cut, 3, 6);
    expect(masterDuration(cut)).toBe(6);
    expect(masterTimelineDuration(cut)).toBe(10);
    expect(
      cut.segments.map((segment) => [
        segment.start,
        segment.end,
        !!segment.excluded,
      ]),
    ).toEqual([
      [0, 2, false],
      [2, 4, true],
      [4, 6, true],
      [6, 10, false],
    ]);
    cut = restoreMasterSegment(cut, firstCut.id);
    expect(masterDuration(cut)).toBe(8);
    expect(
      cut.segments
        .filter((segment) => segment.excluded)
        .map((segment) => [segment.start, segment.end]),
    ).toEqual([[4, 6]]);
    expect(masterToTimelineTime(masterTimelineClips(cut), 4)).toBe(6);
  });

  it("cuts within explicit manual trims without bringing discarded source edges back", () => {
    let trimmed = project();
    trimmed = trimSegment(trimmed, trimmed.segments[0].id, 1, 9);
    const cut = excludeMasterRange(trimmed, 2, 4);
    expect(
      cut.segments.map((segment) => [
        segment.start,
        segment.end,
        !!segment.excluded,
      ]),
    ).toEqual([
      [1, 3, false],
      [3, 5, true],
      [5, 9, false],
    ]);
    expect(masterDuration(cut)).toBe(6);
    expect(masterTimelineDuration(cut)).toBe(8);
    const restored = restoreMasterSegment(
      cut,
      cut.segments.find((segment) => segment.excluded)!.id,
    );
    expect(masterDuration(restored)).toBe(8);
    expect(restored.tracks[0].duration).toBe(10);
  });

  it("cuts across selected sources while leaving unselected alternatives untouched", () => {
    let mixed = appendTracks(project(), [track("b"), track("c")]);
    // Put both sources into the same selected sentence, as a manual custom mix.
    const first = mixed.groups[0];
    const a = mixed.segments[0];
    const b = mixed.segments[1];
    mixed = {
      ...mixed,
      groups: [{ ...first, segmentIds: [a.id, b.id, mixed.segments[2].id] }],
      segments: mixed.segments.map((segment) => ({
        ...segment,
        groupId: first.id,
        enabled: segment.trackId !== "c",
      })),
    };
    const beforeC = mixed.segments[2];
    const cut = excludeMasterRange(mixed, 8, 12);
    expect(
      masterClips(cut).map((clip) => [
        clip.trackId,
        clip.start,
        clip.end,
        clip.offset,
      ]),
    ).toEqual([
      ["a", 0, 8, 0],
      ["b", 2, 10, 8],
    ]);
    expect(masterDuration(cut)).toBe(16);
    expect(masterTimelineDuration(cut)).toBe(20);
    expect(cut.segments.find((segment) => segment.trackId === "c")).toBe(
      beforeC,
    );
    expect(parseProject(cut)).toEqual(cut);
  });

  it("maps cuts through different sentence speeds and keeps genuine joint pauses exactly once", () => {
    let mixed = applyAlignment(appendTracks(newProject(), [track("a", 12)]), {
      groups: [0, 1].map((index) => ({
        text: `Sentence ${index + 1}.`,
        note: "",
        variations: [
          {
            trackId: "a",
            start: index * 6 + 1,
            end: index * 6 + 5,
            text: `Sentence ${index + 1}.`,
          },
        ],
      })),
    });
    mixed = setGroupSpeed(mixed, mixed.groups[0].id, 2);
    mixed = setGroupSpeed(mixed, mixed.groups[1].id, 0.5);
    mixed = setJointDefaults(mixed, {
      pauseMs: 250,
      fadeInMs: 100,
      fadeOutMs: 200,
    });
    expect(masterDuration(mixed)).toBe(15.25);
    const cut = excludeMasterRange(mixed, 2, 5.25);
    expect(
      cut.segments
        .filter((segment) => segment.excluded)
        .map((segment) => [segment.start, segment.end]),
    ).toEqual([
      [4, 6],
      [6, 7],
    ]);
    expect(
      masterClips(cut).map((clip) => [
        clip.start,
        clip.end,
        clip.offset,
        clip.duration,
        clip.pauseBeforeMs,
      ]),
    ).toEqual([
      [0, 4, 0, 2, 0],
      [7, 12, 2.25, 10, 250],
    ]);
    expect(masterTimelineDuration(cut)).toBe(15.25);
    const timeline = masterTimelineClips(cut);
    expect(masterToTimelineTime(timeline, 2)).toBe(5);
    expect(masterToTimelineTime(timeline, 2.125)).toBe(5.125);
    expect(masterToTimelineTime(timeline, 2.25)).toBe(5.25);
    expect(timelineToMasterTime(timeline, 4)).toBe(2);
    expect(timelineToMasterTime(timeline, 5.125)).toBe(2.125);
    expect(masterClips(cut)[0].fadeOutMs).toBe(200);
    expect(masterClips(cut)[1].fadeInMs).toBe(100);
  });

  it("uses neighboring audible sentences after an entire group is cut", () => {
    let mixed = setJointDefaults(grouped(), { pauseMs: 100 });
    const [a, b, c] = mixed.groups;
    mixed = setJointOverride(mixed, a.id, b.id, { pauseMs: 200 });
    mixed = setJointOverride(mixed, b.id, c.id, { pauseMs: 300 });
    mixed = setJointOverride(mixed, a.id, c.id, { pauseMs: 450 });
    const cut = excludeMasterRange(mixed, 4.2, 8.2);
    expect(
      masterClips(cut).map((clip) => [
        clip.groupId,
        clip.offset,
        clip.pauseBeforeMs,
      ]),
    ).toEqual([
      [a.id, 0, 0],
      [c.id, 4.45, 450],
    ]);
    expect(masterDuration(cut)).toBe(8.45);
    expect(masterTimelineDuration(cut)).toBe(12.45);
    expect(
      masterTimelineClips(cut).map((clip) => [
        clip.groupId,
        clip.offset,
        clip.playbackOffset,
        clip.pauseBeforeMs,
      ]),
    ).toEqual([
      [a.id, 0, 0, 0],
      [b.id, 4, 4, 0],
      [c.id, 8.45, 4.45, 450],
    ]);
    const timeline = masterTimelineClips(cut);
    expect(masterToTimelineTime(timeline, 4)).toBe(8);
    expect(masterToTimelineTime(timeline, 4.2)).toBeCloseTo(8.2);
    expect(timelineToMasterTime(timeline, 8.2)).toBeCloseTo(4.2);
  });

  it("retains source exclusions when choosing another variation and choosing back", () => {
    let mixed = project();
    // A separately imported snippet is another choice for the existing group.
    const target = mixed.groups[0].id;
    mixed = appendSentenceAlternatives(mixed, target, [track("rewrite", 4)]);
    mixed = excludeMasterRange(mixed, 2, 4);
    const cuts = mixed.segments.filter((segment) => segment.excluded);
    mixed = chooseVariation(mixed, target, "rewrite");
    expect(masterDuration(mixed)).toBe(4);
    expect(masterTimelineClips(mixed)).toHaveLength(1);
    mixed = chooseVariation(mixed, target, "a");
    expect(masterDuration(mixed)).toBe(8);
    expect(
      mixed.segments
        .filter((segment) => segment.excluded)
        .map((segment) => segment.id),
    ).toEqual(cuts.map((segment) => segment.id));
  });

  it("restores a gray manual piece on click, even when its variation was disabled", () => {
    let cut = excludeMasterRange(project(), 2, 4);
    const removed = cut.segments.find((segment) => segment.excluded)!;
    cut = {
      ...cut,
      segments: cut.segments.map((segment) =>
        segment.id === removed.id ? { ...segment, enabled: false } : segment,
      ),
    };
    const restored = toggleSegment(cut, removed.id);
    expect(
      restored.segments.find((segment) => segment.id === removed.id),
    ).toMatchObject({ enabled: true, excluded: false });
    expect(masterDuration(restored)).toBe(10);
    expect(
      toggleSegment(restored, removed.id).segments.find(
        (segment) => segment.id === removed.id,
      )?.enabled,
    ).toBe(false);
    expect(restoreMasterSegment(restored, removed.id)).toBe(restored);
    expect(() => restoreMasterSegment(restored, "missing")).toThrow(
      /no longer exists/,
    );
  });

  it("validates persisted exclusions and refuses unsafe regrouping instead of dropping cuts", () => {
    const cut = excludeMasterRange(grouped(), 1, 2);
    expect(parseProject(JSON.parse(JSON.stringify(cut)))).toEqual(cut);
    for (const excluded of [null, 1, "yes", {}])
      expect(() =>
        parseProject({
          ...cut,
          segments: cut.segments.map((segment, index) =>
            index ? segment : { ...segment, excluded },
          ),
        }),
      ).toThrow(/exclusion/);
    const before = JSON.stringify(cut);
    expect(() => applyAlignment(cut, { groups: [] })).toThrow();
    expect(() =>
      applyAlignment(cut, {
        groups: [
          {
            text: "New.",
            note: "",
            variations: [{ trackId: "a", start: 1, end: 2, text: "New." }],
          },
        ],
      }),
    ).toThrow(/removed master audio/);
    expect(JSON.stringify(cut)).toBe(before);
  });

  it("retains scoped snippet cuts through safe regrouping", () => {
    let mixed = grouped();
    const target = mixed.groups[1].id;
    mixed = appendSentenceAlternatives(mixed, target, [track("rewrite", 4)]);
    mixed = chooseVariation(mixed, target, "rewrite");
    mixed = excludeMasterRange(mixed, 5, 6);
    const pieces = mixed.segments.filter(
      (segment) => segment.trackId === "rewrite",
    );
    const regrouped = applyAlignment(mixed, {
      groups: [0, 1, 2].map((index) => ({
        text: `Sentence ${index + 1}.`,
        note: "",
        variations: [
          {
            trackId: "a",
            start: index * 4 + 1,
            end: index * 4 + 3,
            text: `Sentence ${index + 1}.`,
          },
        ],
      })),
    });
    expect(
      regrouped.segments.filter((segment) => segment.trackId === "rewrite"),
    ).toEqual(pieces);
    expect(masterDuration(regrouped)).toBe(11);
  });

  it("rounds source cuts to samples and preserves the full partition for every supported speed", () => {
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5]) {
      const frames = 480_013;
      let original = appendTracks(newProject(), [track("a", frames / 48_000)]);
      original = setGroupSpeed(original, original.groups[0].id, speed);
      const duration = masterDuration(original);
      const cut = excludeMasterRange(
        original,
        duration * 0.2312345,
        duration * 0.7187654,
      );
      const sourcePieces = cut.segments.map((segment) => [
        Math.round(segment.start * 48_000),
        Math.round(segment.end * 48_000),
      ]);
      expect(sourcePieces).toEqual([
        [0, Math.round(frames * 0.2312345)],
        [Math.round(frames * 0.2312345), Math.round(frames * 0.7187654)],
        [Math.round(frames * 0.7187654), frames],
      ]);
      expect(
        sourcePieces.reduce((total, [start, end]) => total + end - start, 0),
      ).toBe(frames);
      const outputFrames = cut.segments
        .filter((segment) => !segment.excluded)
        .reduce(
          (total, segment) =>
            total +
            Math.round(
              (Math.round(segment.end * 48_000) -
                Math.round(segment.start * 48_000)) /
                speed,
            ),
          0,
        );
      expect(Math.round(masterDuration(cut) * 48_000)).toBe(outputFrames);
      expect(
        Math.abs(masterTimelineDuration(cut) - duration),
      ).toBeLessThanOrEqual(2 / 48_000);
      const timeline = masterTimelineClips(cut);
      for (const clip of timeline.filter((clip) => !clip.excluded)) {
        const time = clip.playbackOffset + clip.duration * 0.38123;
        expect(
          timelineToMasterTime(timeline, masterToTimelineTime(timeline, time)),
        ).toBeCloseTo(time, 10);
      }
      expect(parseProject(cut)).toEqual(cut);
    }
  });

  it("rejects invalid time inputs without mutating saved edits", () => {
    const original = project();
    const timeline = masterTimelineClips(original);
    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      expect(() => excludeMasterRange(original, invalid, 2)).toThrow(/finite/);
      expect(() => excludeMasterRange(original, 0, invalid)).toThrow(/finite/);
      expect(() => masterToTimelineTime(timeline, invalid)).toThrow(/finite/);
      expect(() => timelineToMasterTime(timeline, invalid)).toThrow(/finite/);
    }
    expect(masterToTimelineTime([], 0)).toBe(0);
    expect(timelineToMasterTime([], 0)).toBe(0);
  });

  it("preserves one-frame source remnants without scheduling or exporting zero-frame audio", () => {
    let tiny = appendTracks(newProject(), [track("a", 3 / 48_000)]);
    tiny = setGroupSpeed(tiny, tiny.groups[0].id, 2.5);
    const cut = excludeMasterRange(tiny, 0, 2 / 3 / 48_000);
    expect(
      cut.segments.map((segment) => [
        Math.round(segment.start * 48_000),
        Math.round(segment.end * 48_000),
        !!segment.excluded,
      ]),
    ).toEqual([
      [0, 2, true],
      [2, 3, false],
    ]);
    expect(masterClips(cut)).toEqual([]);
    expect(masterDuration(cut)).toBe(0);
    expect(
      masterTimelineClips(cut).map((clip) => [clip.duration, !!clip.excluded]),
    ).toEqual([
      [1 / 48_000, true],
      [0, false],
    ]);
    expect(masterToTimelineTime(masterTimelineClips(cut), 0)).toBe(1 / 48_000);
    expect(timelineToMasterTime(masterTimelineClips(cut), 1 / 48_000)).toBe(0);
    const slower = setGroupSpeed(cut, cut.groups[0].id, 0.5);
    expect(masterClips(slower)).toHaveLength(1);
    expect(masterClips(slower)[0]).toMatchObject({
      start: 2 / 48_000,
      end: 3 / 48_000,
      duration: 2 / 48_000,
    });
    expect(parseProject(cut)).toEqual(cut);
    const restored = restoreMasterSegment(cut, cut.segments[0].id);
    expect(masterClips(restored).map((clip) => clip.duration)).toEqual([
      1 / 48_000,
    ]);
    expect(
      restored.segments.reduce(
        (frames, segment) =>
          frames +
          Math.round(segment.end * 48_000) -
          Math.round(segment.start * 48_000),
        0,
      ),
    ).toBe(3);
  });

  it("ignores zero-output groups when resolving genuine joint pauses", () => {
    let tiny = applyAlignment(
      appendTracks(newProject(), [track("a", 5 / 48_000)]),
      {
        groups: [
          [0, 2],
          [2, 3],
          [3, 5],
        ].map(([start, end], index) => ({
          text: `Part ${index + 1}.`,
          note: "",
          variations: [
            {
              trackId: "a",
              start: start / 48_000,
              end: end / 48_000,
              text: `Part ${index + 1}.`,
            },
          ],
        })),
      },
    );
    const [a, b, c] = tiny.groups;
    tiny = setGroupSpeed(tiny, b.id, 2.5);
    tiny = setJointDefaults(tiny, { pauseMs: 1000 });
    tiny = setJointOverride(tiny, a.id, c.id, { pauseMs: 250 });
    expect(
      masterClips(tiny).map((clip) => [clip.groupId, clip.pauseBeforeMs]),
    ).toEqual([
      [a.id, 0],
      [c.id, 250],
    ]);
    expect(Math.round(masterDuration(tiny) * 48_000)).toBe(4 + 12_000);
    expect(
      masterTimelineClips(tiny).map((clip) => [
        clip.groupId,
        clip.duration,
        clip.pauseBeforeMs,
      ]),
    ).toEqual([
      [a.id, 2 / 48_000, 0],
      [b.id, 0, 0],
      [c.id, 2 / 48_000, 250],
    ]);
  });
});
