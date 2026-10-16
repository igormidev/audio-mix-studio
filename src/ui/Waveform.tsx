import { useId } from "react";
export function Waveform({
  peaks,
  color = "currentColor",
  start = 0,
  end = 1,
  bars = 100,
  className = "",
}: {
  peaks: number[];
  color?: string;
  start?: number;
  end?: number;
  bars?: number;
  className?: string;
}) {
  const id = useId();
  const slice = peaks.slice(
    Math.floor(start * peaks.length),
    Math.max(
      Math.floor(start * peaks.length) + 1,
      Math.ceil(end * peaks.length),
    ),
  );
  return (
    <svg
      className={`waveform ${className}`}
      viewBox={`0 0 ${bars * 4} 64`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <title id={id}>Audio waveform</title>
      {Array.from({ length: bars }, (_, i) => {
        const index = Math.floor((i / bars) * slice.length);
        const value = Math.min(1, Math.max(0, slice[index] ?? 0));
        const height = Math.max(2, value * 54);
        return (
          <rect
            key={i}
            x={i * 4}
            y={(64 - height) / 2}
            width="2.3"
            height={height}
            rx="1.1"
            fill={color}
          />
        );
      })}
    </svg>
  );
}
