/** One SVG path keeps a long timeline light while preserving measured bars. */
export function waveformGeometry(
  peaks: readonly number[],
  start = 0,
  end = 1,
  bars = 100,
): { path: string; width: number } {
  const count = Number.isFinite(bars)
    ? Math.min(2_000, Math.max(1, Math.floor(bars)))
    : 100;
  const fraction = (value: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  const from = Math.floor(fraction(start, 0) * peaks.length);
  const until = Math.min(
    peaks.length,
    Math.max(from + 1, Math.ceil(fraction(end, 1) * peaks.length)),
  );
  const length = Math.max(0, until - from);
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    const sample = peaks[from + Math.floor((index / count) * length)] ?? 0;
    const value = Number.isFinite(sample)
      ? Math.min(1, Math.max(0, sample))
      : 0;
    const height = Math.max(2, value * 54);
    const x = index * 4;
    const y = (64 - height) / 2;
    // Match rect rx=1.1: SVG clamps the vertical radius independently.
    const radiusX = 1.1;
    const radiusY = Math.min(1.1, height / 2);
    const right = x + 2.3;
    const bottom = y + height;
    paths.push(
      `M${x + radiusX},${y}H${right - radiusX}` +
        `A${radiusX},${radiusY} 0 0 1 ${right},${y + radiusY}` +
        `V${bottom - radiusY}A${radiusX},${radiusY} 0 0 1 ${right - radiusX},${bottom}` +
        `H${x + radiusX}A${radiusX},${radiusY} 0 0 1 ${x},${bottom - radiusY}` +
        `V${y + radiusY}A${radiusX},${radiusY} 0 0 1 ${x + radiusX},${y}Z`,
    );
  }
  return { path: paths.join(""), width: count * 4 };
}
