import { memo, useMemo } from "react";
import { waveformGeometry } from "./waveformGeometry";

export const Waveform = memo(function Waveform({
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
  const { path, width } = useMemo(
    () => waveformGeometry(peaks, start, end, bars),
    [peaks, start, end, bars],
  );
  return (
    <svg
      className={`waveform ${className}`}
      viewBox={`0 0 ${width} 64`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={path} fill={color} />
    </svg>
  );
});
