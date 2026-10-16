import { describe, expect, it } from "vitest";
import { waveformGeometry } from "../src/ui/waveformGeometry";

function tops(path: string): number[] {
  return [...path.matchAll(/M[^,]+,([\d.-]+)/g)].map((match) =>
    Number(match[1]),
  );
}

describe("waveform geometry", () => {
  it("uses only measured peaks inside the selected source range", () => {
    const geometry = waveformGeometry(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      1 / 3,
      2 / 3,
      4,
    );
    expect(geometry.width).toBe(16);
    const values = tops(geometry.path);
    expect(values).toHaveLength(4);
    [23.9, 23.9, 21.2, 21.2].forEach((height, index) =>
      expect(values[index]).toBeCloseTo(height),
    );
  });
  it("draws an empty source at the baseline and clamps invalid amplitudes", () => {
    expect(tops(waveformGeometry([], 0, 1, 3).path)).toEqual([31, 31, 31]);
    const geometry = waveformGeometry(
      [Number.NaN, Number.POSITIVE_INFINITY, -1, 2],
      0,
      1,
      4,
    );
    expect(tops(geometry.path)).toEqual([31, 31, 31, 5]);
    expect(geometry.path).not.toMatch(/NaN|Infinity/);
  });
  it("bounds malformed geometry requests without nonfinite SVG coordinates", () => {
    const geometry = waveformGeometry(
      [0.5],
      Number.NaN,
      Number.POSITIVE_INFINITY,
      100_000,
    );
    expect(geometry.width).toBe(8_000);
    expect(tops(geometry.path)).toHaveLength(2_000);
    expect(geometry.path).not.toMatch(/NaN|Infinity/);
  });
});
