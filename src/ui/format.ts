export function clock(seconds: number, precise = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const whole = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${whole}${
    precise
      ? `.${Math.floor((safe % 1) * 100)
          .toString()
          .padStart(2, "0")}`
      : ""
  }`;
}
export const secondsLabel = (value: number) => `${value.toFixed(1)}s`;
