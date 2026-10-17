import { describe, expect, it } from "vitest";
import type { AudioTrack } from "../../src/shared/types";
import {
  alignmentInputs,
  codexArguments,
  codexTranscriptInput,
  validateAlignment,
} from "./alignment";

function track(id: string, text: string[]): AudioTrack {
  return {
    id,
    name: id,
    duration: text.length * 2,
    color: "#123456",
    peaks: [],
    mediaUrl: "",
    transcript: {
      model: "large-v3-turbo",
      language: "en",
      segments: [],
      words: text.map((text, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        text,
      })),
    },
  };
}

describe("structured transcript alignment", () => {
  it("supplies explicit word indices while keeping source paths and audio metadata out of the prompt", () => {
    const source = track("opaque-id", ["First", "sentence.", "Second."]);
    source.name = "personal-source.wav";
    source.mediaUrl = "/private/personal-source.wav";
    const text = codexTranscriptInput(alignmentInputs([source]));
    expect(JSON.parse(text)).toEqual([
      {
        trackId: "opaque-id",
        granularity: "word",
        units: [
          [0, "First"],
          [1, "sentence."],
          [2, "Second."],
        ],
      },
    ]);
    expect(text).not.toContain("personal-source");
    expect(text).not.toContain("duration");
  });

  it("keeps quoted transcript analysis isolated from local execution, accounts, hooks and memory", () => {
    const args = codexArguments(
      "/private/work",
      "/private/schema.json",
      "/private/result.json",
    );
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ephemeral");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
    for (const capability of [
      "shell_tool",
      "apps",
      "plugins",
      "hooks",
      "memories",
      "multi_agent",
      "computer_use",
    ])
      expect(args).toContain(`features.${capability}=false`);
    expect(args).toContain("features.skip_host_skill_discovery=true");
    expect(args).toContain('web_search="disabled"');
    expect(args.some((value) => value.includes("dangerously"))).toBe(false);
  });

  it("maps inclusive word ranges to exact source times and retains a unique inserted sentence", () => {
    const inputs = alignmentInputs([
      track("a", ["Hello.", "Goodbye."]),
      track("b", ["Welcome.", "Extra.", "Bye."]),
    ]);
    const result = validateAlignment(
      {
        groups: [
          {
            text: "Welcome.",
            note: "",
            variations: [
              { trackId: "a", startUnit: 0, endUnit: 0 },
              { trackId: "b", startUnit: 0, endUnit: 0 },
            ],
          },
          {
            text: "Extra.",
            note: "Additional context",
            variations: [{ trackId: "b", startUnit: 1, endUnit: 1 }],
          },
          {
            text: "Goodbye.",
            note: "",
            variations: [
              { trackId: "a", startUnit: 1, endUnit: 1 },
              { trackId: "b", startUnit: 2, endUnit: 2 },
            ],
          },
        ],
      },
      inputs,
    );
    expect(result.groups.map((group) => group.variations.length)).toEqual([
      2, 1, 2,
    ]);
    expect(result.groups[2].variations[1]).toEqual({
      trackId: "b",
      start: 4,
      end: 5,
      text: "Bye.",
    });
  });

  it("keeps unaligned language chunks intact and skips silent tracks", () => {
    const unaligned = track("a", []);
    unaligned.duration = 3;
    unaligned.transcript!.segments = [
      { start: 0.3, end: 2.7, text: "A whole ASR chunk." },
    ];
    const inputs = alignmentInputs([unaligned, track("silent", [])]);
    expect(inputs).toHaveLength(1);
    expect(
      validateAlignment(
        {
          groups: [
            {
              text: "A whole ASR chunk.",
              note: "",
              variations: [{ trackId: "a", startUnit: 0, endUnit: 0 }],
            },
          ],
        },
        inputs,
      ).groups[0].variations[0].text,
    ).toBe("A whole ASR chunk.");
  });

  it("rejects omitted words, duplicate coverage and invented boundaries before a project changes", () => {
    const inputs = alignmentInputs([track("a", ["One.", "Two."])]);
    const group = {
      text: "One.",
      note: "",
      variations: [{ trackId: "a", startUnit: 0, endUnit: 0 }],
    };
    expect(() => validateAlignment({ groups: [group] }, inputs)).toThrow(
      /omitted/,
    );
    expect(() => validateAlignment({ groups: [group, group] }, inputs)).toThrow(
      /twice/,
    );
    expect(() =>
      validateAlignment(
        {
          groups: [
            {
              ...group,
              variations: [{ trackId: "a", startUnit: 0, endUnit: 2 }],
            },
          ],
        },
        inputs,
      ),
    ).toThrow(/unknown source or word/);
    expect(() =>
      validateAlignment(
        {
          groups: [
            {
              ...group,
              variations: [
                { trackId: "secret-path", startUnit: 0, endUnit: 1 },
              ],
            },
          ],
        },
        inputs,
      ),
    ).toThrow(/unknown source/);
  });

  it("retains full ASR speech if forced alignment omitted an unalignable word", () => {
    const source = track("a", ["The", "cost", "is"]);
    source.transcript!.segments = [
      { start: 0, end: 6, text: "The cost is $1,000." },
    ];
    const inputs = alignmentInputs([source]);
    expect(inputs[0].granularity).toBe("segment");
    const result = validateAlignment(
      {
        groups: [
          {
            text: "The cost is $1,000.",
            note: "",
            variations: [{ trackId: "a", startUnit: 0, endUnit: 0 }],
          },
        ],
      },
      inputs,
    );
    expect(result.groups[0].variations[0]).toMatchObject({
      start: 0,
      end: 6,
      text: "The cost is $1,000.",
    });
  });

  it("rejects cuts across overlapping word timestamps so the model can merge that phrase", () => {
    const source = track("a", ["First.", "Second."]);
    source.transcript!.words[0].end = 2.2;
    const inputs = alignmentInputs([source]);
    expect(() =>
      validateAlignment(
        {
          groups: [
            {
              text: "First.",
              note: "",
              variations: [{ trackId: "a", startUnit: 0, endUnit: 0 }],
            },
            {
              text: "Second.",
              note: "",
              variations: [{ trackId: "a", startUnit: 1, endUnit: 1 }],
            },
          ],
        },
        inputs,
      ),
    ).toThrow(/boundaries overlap/);
    expect(
      validateAlignment(
        {
          groups: [
            {
              text: "First. Second.",
              note: "",
              variations: [{ trackId: "a", startUnit: 0, endUnit: 1 }],
            },
          ],
        },
        inputs,
      ).groups,
    ).toHaveLength(1);
  });

  it("rejects corrupt source timestamps and duplicate track IDs", () => {
    const corrupted = track("a", ["A."]);
    corrupted.transcript!.words[0].end = Number.NaN;
    expect(() => alignmentInputs([corrupted])).toThrow(/invalid timing/);
    expect(() =>
      alignmentInputs([track("a", ["A."]), track("a", ["B."])]),
    ).toThrow(/unique IDs/);
  });
});
