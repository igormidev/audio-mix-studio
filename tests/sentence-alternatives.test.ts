import { describe, expect, it } from "vitest";
import {
  appendSentenceAlternatives,
  appendTracks,
  applyAlignment,
  chooseVariation,
  jointKey,
  masterClips,
  masterDuration,
  moveGroup,
  newProject,
  parseProject,
  removeTrack,
  setGroupSpeed,
  setJointOverride,
  splitSegment,
  toggleSegment,
  trimSegment,
} from "../src/domain/project";
import type { AlignmentResult, AudioTrack } from "../src/shared/types";

function track(id: string, duration = 10): AudioTrack {
  return {
    id,
    name: `${id}.wav`,
    duration,
    color: "#4c8dba",
    peaks: [0, 0.1, 1],
    mediaUrl: `mixmedia://audio/${id}`,
  };
}

const alignment: AlignmentResult = {
  groups: [
    {
      text: "First sentence.",
      note: "",
      variations: [
        { trackId: "a", start: 1, end: 2, text: "First sentence." },
        { trackId: "b", start: 1, end: 2, text: "First sentence." },
      ],
    },
    {
      text: "Second sentence.",
      note: "",
      variations: [
        { trackId: "a", start: 4, end: 5, text: "Second sentence." },
        { trackId: "b", start: 4, end: 5, text: "Second sentence." },
      ],
    },
  ],
};

function project() {
  return applyAlignment(
    appendTracks(newProject(), [track("a"), track("b")]),
    alignment,
  );
}

describe("sentence-scoped audio alternatives", () => {
  it("adds full sources only to the target and leaves the audible mix and edits untouched", () => {
    let original = project();
    const [first, second] = original.groups;
    original = chooseVariation(original, first.id, "b");
    original = setGroupSpeed(original, second.id, 1.25);
    original = setJointOverride(original, first.id, second.id, {
      pauseMs: 250,
    });
    const before = JSON.stringify(original);
    const incoming = [track("rewrite", 2.123456), track("another", 3.5)];
    const next = appendSentenceAlternatives(original, second.id, incoming);

    expect(JSON.stringify(original)).toBe(before);
    expect(
      incoming.every((source) => source.sentenceGroupId === undefined),
    ).toBe(true);
    expect(next.groups.map((group) => group.id)).toEqual(
      original.groups.map((group) => group.id),
    );
    expect(next.groups[0]).toBe(original.groups[0]);
    expect(next.groups[1].speed).toBe(1.25);
    expect(next.jointOverrides).toBe(original.jointOverrides);
    expect(masterClips(next)).toEqual(masterClips(original));
    expect(next.segments.slice(0, original.segments.length)).toEqual(
      original.segments,
    );
    expect(
      next.tracks.slice(-2).map((source) => source.sentenceGroupId),
    ).toEqual([second.id, second.id]);
    expect(
      next.segments.slice(-2).map((segment) => ({
        groupId: segment.groupId,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        enabled: segment.enabled,
      })),
    ).toEqual([
      {
        groupId: second.id,
        start: 0,
        end: 2.123456,
        text: "rewrite.wav",
        enabled: false,
      },
      {
        groupId: second.id,
        start: 0,
        end: 3.5,
        text: "another.wav",
        enabled: false,
      },
    ]);
    expect(next.tracks.at(-1)?.transcript).toBeUndefined();
    expect(parseProject(next)).toEqual(next);
  });

  it("retains real incoming transcript text without creating one for untranscribed audio", () => {
    const original = project();
    const source = {
      ...track("rewrite", 2),
      transcript: {
        model: "large-v3-turbo",
        language: "en",
        words: [],
        segments: [{ start: 0.5, end: 1.5, text: "My rewritten sentence." }],
      },
    };
    const next = appendSentenceAlternatives(original, original.groups[1].id, [
      source,
    ]);
    expect(next.segments.at(-1)?.text).toBe("My rewritten sentence.");
    expect(next.segments.at(-1)?.start).toBe(0);
    expect(next.segments.at(-1)?.end).toBe(2);
    expect(next.tracks.at(-1)?.transcript).toEqual(source.transcript);
  });

  it("does not enable a skipped sentence; selecting the choice later affects that sentence only", () => {
    let original = project();
    const second = original.groups[1];
    original = toggleSegment(original, second.segmentIds[0]);
    const added = appendSentenceAlternatives(original, second.id, [
      track("rewrite", 2),
    ]);
    expect(masterClips(added)).toEqual(masterClips(original));
    const chosen = chooseVariation(added, second.id, "rewrite");
    expect(masterClips(chosen).map((clip) => clip.trackId)).toEqual([
      "a",
      "rewrite",
    ]);
    expect(masterClips(chosen)[1].start).toBe(0);
    expect(masterClips(chosen)[1].end).toBe(2);
    expect(masterDuration(chosen)).toBe(5);
    expect(chosen.groups).toBe(added.groups);
    expect(() =>
      chooseVariation(added, original.groups[0].id, "rewrite"),
    ).toThrow(/not available/);
  });

  it("rejects missing targets, duplicate IDs, invalid duration, and reassigned scopes atomically", () => {
    const original = project();
    const target = original.groups[1].id;
    const before = JSON.stringify(original);
    expect(() => appendSentenceAlternatives(original, "missing", [])).toThrow(
      /no longer exists/,
    );
    expect(() =>
      appendSentenceAlternatives(original, target, [track("a")]),
    ).toThrow(/repeated/);
    expect(() =>
      appendSentenceAlternatives(original, target, [track("x"), track("x")]),
    ).toThrow(/repeated/);
    expect(() =>
      appendSentenceAlternatives(original, target, [track("x", Number.NaN)]),
    ).toThrow(/finite/);
    expect(() =>
      appendSentenceAlternatives(original, target, [
        { ...track("x"), sentenceGroupId: original.groups[0].id },
      ]),
    ).toThrow(/another sentence/);
    expect(() =>
      appendTracks(original, [{ ...track("x"), sentenceGroupId: target }]),
    ).toThrow(/target sentence/);
    expect(appendSentenceAlternatives(original, target, [])).toBe(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("validates ownership when parsing saved and portable manifests", () => {
    const original = project();
    const target = original.groups[1].id;
    const added = appendSentenceAlternatives(original, target, [
      track("rewrite", 2),
    ]);
    expect(parseProject(JSON.parse(JSON.stringify(added)))).toEqual(added);
    for (const sentenceGroupId of ["", "missing", null, 1])
      expect(() =>
        parseProject({
          ...added,
          tracks: added.tracks.map((source) =>
            source.id === "rewrite" ? { ...source, sentenceGroupId } : source,
          ),
        }),
      ).toThrow();
    expect(() =>
      parseProject({
        ...added,
        tracks: added.tracks.map((source) =>
          source.id === "rewrite"
            ? { ...source, sentenceGroupId: original.groups[0].id }
            : source,
        ),
      }),
    ).toThrow(/wrong sentence/);
    expect(() =>
      parseProject({
        ...added,
        tracks: [
          ...added.tracks,
          { ...track("orphan"), sentenceGroupId: target },
        ],
      }),
    ).toThrow(/no source segments/);
  });

  it("preserves scoped choices and their manual edits through safe regrouping", () => {
    let mixed = project();
    const [first, second] = mixed.groups;
    mixed = appendSentenceAlternatives(mixed, second.id, [track("rewrite", 2)]);
    mixed = chooseVariation(mixed, second.id, "rewrite");
    const snippet = mixed.segments.at(-1)!;
    mixed = splitSegment(mixed, snippet.id, 1);
    mixed = trimSegment(mixed, snippet.id, 0.1, 0.8);
    mixed = toggleSegment(mixed, mixed.segments.at(-1)!.id);
    mixed = setGroupSpeed(mixed, second.id, 1.5);
    mixed = setJointOverride(mixed, first.id, second.id, { pauseMs: 350 });
    const savedPieces = mixed.segments.filter(
      (segment) => segment.trackId === "rewrite",
    );
    const regrouped = applyAlignment(mixed, alignment);
    expect(regrouped.groups.map((group) => group.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(regrouped.groups[1].speed).toBe(1.5);
    expect(
      regrouped.segments.filter((segment) => segment.trackId === "rewrite"),
    ).toEqual(savedPieces);
    expect(regrouped.jointOverrides?.[jointKey(first.id, second.id)]).toEqual({
      pauseMs: 350,
    });
    expect(masterClips(regrouped).map((clip) => clip.trackId)).toEqual([
      "a",
      "rewrite",
    ]);
    expect(parseProject(regrouped)).toEqual(regrouped);
  });

  it("rejects regrouping that removes its target or treats the snippet as a complete take", () => {
    const original = project();
    const added = appendSentenceAlternatives(original, original.groups[1].id, [
      track("rewrite", 2),
    ]);
    const before = JSON.stringify(added);
    expect(() =>
      applyAlignment(added, { groups: [alignment.groups[0]] }),
    ).toThrow(/sentence with added audio/);
    expect(() =>
      applyAlignment(added, {
        groups: [
          {
            text: "Rewrite.",
            note: "",
            variations: [
              { trackId: "rewrite", start: 0, end: 2, text: "Rewrite." },
            ],
          },
        ],
      }),
    ).toThrow(/unknown track/);
    expect(JSON.stringify(added)).toBe(before);
  });

  it("rejects repeated target labels even when equal counts would reattach a reordered owner's audio incorrectly", () => {
    const duplicateAlignment: AlignmentResult = {
      groups: alignment.groups.map((group) => ({
        ...group,
        text: "Repeated sentence.",
      })),
    };
    const original = applyAlignment(
      appendTracks(newProject(), [track("a"), track("b")]),
      duplicateAlignment,
    );
    const added = appendSentenceAlternatives(original, original.groups[1].id, [
      track("rewrite", 2),
    ]);
    expect(() =>
      applyAlignment(added, { groups: [duplicateAlignment.groups[0]] }),
    ).toThrow(/repeated sentence with added audio/);
    expect(() => applyAlignment(added, duplicateAlignment)).toThrow(
      /repeated sentence with added audio/,
    );
    const reordered = moveGroup(added, original.groups[1].id, -1);
    const before = JSON.stringify(reordered);
    expect(() => applyAlignment(reordered, duplicateAlignment)).toThrow(
      /repeated sentence with added audio/,
    );
    expect(JSON.stringify(reordered)).toBe(before);
    expect(reordered.tracks.at(-1)?.sentenceGroupId).toBe(
      original.groups[1].id,
    );
  });

  it("rejects newly duplicated target labels instead of choosing an arbitrary new occurrence", () => {
    const original = project();
    const added = appendSentenceAlternatives(original, original.groups[1].id, [
      track("rewrite", 2),
    ]);
    const duplicate = {
      groups: alignment.groups.map((group) => ({
        ...group,
        text: original.groups[1].text,
      })),
    };
    expect(() => applyAlignment(added, duplicate)).toThrow(
      /repeated sentence with added audio/,
    );
  });

  it("removes choices safely and falls back when the active choice is removed", () => {
    const original = project();
    const target = original.groups[1].id;
    const added = appendSentenceAlternatives(original, target, [
      track("rewrite", 2),
    ]);
    const removed = removeTrack(added, "rewrite");
    expect(masterClips(removed)).toEqual(masterClips(original));
    expect(removed.groups).toEqual(original.groups);
    expect(removed.segments).toEqual(original.segments);
    const chosen = chooseVariation(added, target, "rewrite");
    const fallback = removeTrack(chosen, "rewrite");
    expect(masterClips(fallback).map((clip) => clip.trackId)).toEqual([
      "a",
      "a",
    ]);
    const onlyChoice = removeTrack(removeTrack(chosen, "a"), "b");
    expect(onlyChoice.groups.map((group) => group.id)).toEqual([target]);
    expect(parseProject(onlyChoice)).toEqual(onlyChoice);
    expect(removeTrack(onlyChoice, "rewrite").groups).toEqual([]);
  });
});
