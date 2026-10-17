import { ArrowDownRight, ArrowUpRight, Timer } from "lucide-react";
import { useRef, useState } from "react";
import type { JointSettings } from "../shared/types";

export function JointDivider({
  value,
  disabled,
  onChange,
  before,
  after,
}: {
  value: JointSettings;
  disabled: boolean;
  onChange: (update: Partial<JointSettings>) => void;
  before: number;
  after: number;
}) {
  return (
    <div
      className="joint-divider"
      role="group"
      aria-label={`Joint between sentences ${before} and ${after}`}
    >
      <span className="joint-line" />
      <div className="joint-controls">
        <JointControl
          label="Fade out"
          value={value.fadeOutMs}
          disabled={disabled}
          max={5000}
          icon={<ArrowDownRight size={12} />}
          onChange={(fadeOutMs) => onChange({ fadeOutMs })}
        />
        <span className="joint-dot">·</span>
        <JointControl
          label="Pause"
          value={value.pauseMs}
          disabled={disabled}
          max={10000}
          icon={<Timer size={12} />}
          onChange={(pauseMs) => onChange({ pauseMs })}
        />
        <span className="joint-dot">·</span>
        <JointControl
          label="Fade in"
          value={value.fadeInMs}
          disabled={disabled}
          max={5000}
          icon={<ArrowUpRight size={12} />}
          onChange={(fadeInMs) => onChange({ fadeInMs })}
        />
      </div>
      <span className="joint-line" />
    </div>
  );
}

function JointControl({
  label,
  value,
  disabled,
  max,
  icon,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  max: number;
  icon: React.ReactNode;
  onChange: (value: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState("above");
  const place = () => {
    const element = container.current;
    const panel = element?.closest(".editor-content");
    if (!element || !panel) return;
    const bounds = element.getBoundingClientRect();
    const viewport = panel.getBoundingClientRect();
    const height =
      element.querySelector<HTMLElement>(".joint-popover")?.offsetHeight ?? 90;
    setPlacement(
      bounds.top - height < viewport.top &&
        viewport.bottom - bounds.bottom > bounds.top - viewport.top
        ? "below"
        : "above",
    );
  };
  return (
    <div
      className="joint-control"
      ref={container}
      data-placement={placement}
      onMouseEnter={place}
      onFocus={place}
    >
      <button
        className="joint-value"
        disabled={disabled}
        aria-label={`${label}: ${value} milliseconds`}
      >
        {icon}
        <span>
          {value}ms {label.toLowerCase()}
        </span>
      </button>
      <div className="joint-popover">
        <label>
          {label}
          <output>{value}ms</output>
          <input
            aria-label={`${label} milliseconds`}
            type="range"
            min={0}
            max={max}
            step={10}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
