import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines } from "lucide-react";
import type { MasterClip, MixProject } from "../shared/types";
import { clock } from "./format";
import { Waveform } from "./Waveform";

export const MasterTimeline = memo(function MasterTimeline({
  project,
  clips,
  duration,
  position,
  active,
  following,
  onSeek,
}: {
  project: MixProject;
  clips: MasterClip[];
  duration: number;
  position: number;
  active: boolean;
  following: boolean;
  onSeek: (seconds: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const anchor = useRef<{ fraction: number; pixel: number } | null>(null);
  const [tooltip, setTooltip] = useState<{
    text: string;
    take: string;
    x: number;
    y: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (element && anchor.current) {
      element.scrollLeft =
        anchor.current.fraction * element.clientWidth * zoom -
        anchor.current.pixel;
      anchor.current = null;
    }
  }, [zoom]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || !active) return;
    const change = (next: number, pixel = element.clientWidth / 2) => {
      const bounded = Math.max(1, Math.min(64, next));
      if (bounded === zoomRef.current) return;
      anchor.current = {
        fraction:
          (element.scrollLeft + pixel) /
          (element.clientWidth * zoomRef.current),
        pixel,
      };
      zoomRef.current = bounded;
      setZoom(bounded);
      setTooltip(null);
    };
    const wheel = (event: WheelEvent) => {
      if (!duration || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (
        Math.abs(event.deltaX) > Math.abs(event.deltaY) &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        element.scrollLeft += event.deltaX;
        return;
      }
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      change(
        zoomRef.current * Math.exp(-delta * 0.004),
        event.clientX - element.getBoundingClientRect().left,
      );
    };
    const command = (event: Event) => {
      if (document.querySelector('[role="dialog"]')) return;
      const action = (event as CustomEvent<string>).detail;
      if (action === "timeline-zoom-in") change(zoomRef.current * 1.25);
      if (action === "timeline-zoom-out") change(zoomRef.current / 1.25);
      if (action === "timeline-zoom-reset") change(1);
    };
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        !(event.metaKey || event.ctrlKey) ||
        target.closest('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        change(
          event.key === "0"
            ? 1
            : event.key === "-"
              ? zoomRef.current / 1.25
              : zoomRef.current * 1.25,
        );
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("studio-shortcut", command);
    window.addEventListener("keydown", keys);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("studio-shortcut", command);
      window.removeEventListener("keydown", keys);
    };
  }, [active, duration]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || !following || !duration) return;
    const x = (position / duration) * element.clientWidth * zoom;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth)
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.15);
  }, [position, following, duration, zoom]);
  return (
    <div
      className="master-timeline"
      ref={scroll}
      data-zoom={zoom.toFixed(3)}
      aria-label="Master timeline · scroll or pinch to zoom"
      onScroll={() => setTooltip(null)}
    >
      <div
        className="master-timeline-canvas"
        style={{ width: `${zoom * 100}%` }}
      >
        <div className="ruler">
          {Array.from(
            { length: Math.max(7, Math.ceil(zoom * 6) + 1) },
            (_, index) => {
              const count = Math.max(6, Math.ceil(zoom * 6));
              return (
                <span key={index}>{clock((duration * index) / count)}</span>
              );
            },
          )}
        </div>
        <div
          className="master-clips"
          onClick={(event) => {
            if (duration)
              onSeek(
                Math.max(
                  0,
                  Math.min(
                    duration,
                    ((event.clientX -
                      event.currentTarget.getBoundingClientRect().left) /
                      event.currentTarget.clientWidth) *
                      duration,
                  ),
                ),
              );
          }}
        >
          {clips.length ? (
            clips.map((clip, index) => {
              const track = project.tracks.find((t) => t.id === clip.trackId)!;
              const text =
                project.groups.find((g) => g.id === clip.groupId)?.text ||
                clip.text;
              return (
                <div
                  className="master-clip"
                  key={clip.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Clip ${index + 1}: ${text}`}
                  style={{
                    left: `${(clip.offset / duration) * 100}%`,
                    width: `${(clip.duration / duration) * 100}%`,
                    color: track.color,
                    background: `${track.color}16`,
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onSeek(clip.offset);
                    }
                  }}
                  onMouseEnter={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setTooltip({
                      text,
                      take: track.name,
                      x: Math.max(
                        160,
                        Math.min(
                          innerWidth - 160,
                          bounds.left + bounds.width / 2,
                        ),
                      ),
                      y: bounds.top - 8,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setTooltip({
                      text,
                      take: track.name,
                      x: Math.max(
                        160,
                        Math.min(
                          innerWidth - 160,
                          bounds.left + bounds.width / 2,
                        ),
                      ),
                      y: bounds.top - 8,
                    });
                  }}
                  onBlur={() => setTooltip(null)}
                >
                  <span className="master-clip-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="master-clip-text">{clip.text}</span>
                  <Waveform
                    peaks={track.peaks}
                    start={clip.start / track.duration}
                    end={clip.end / track.duration}
                    bars={Math.max(
                      2,
                      Math.round((clip.duration / duration) * 220 * zoom),
                    )}
                  />
                </div>
              );
            })
          ) : (
            <div className="master-empty">
              <AudioLines size={26} strokeWidth={1} />
              <span>No clips selected</span>
            </div>
          )}
          {!!clips.length && (
            <div
              className="playhead"
              style={{ left: `${Math.min(100, (position / duration) * 100)}%` }}
            >
              <span />
            </div>
          )}
        </div>
      </div>
      {active &&
        tooltip &&
        createPortal(
          <div
            className="clip-tooltip"
            role="tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <strong>{tooltip.text}</strong>
            <span>{tooltip.take}</span>
          </div>,
          document.body,
        )}
    </div>
  );
});
