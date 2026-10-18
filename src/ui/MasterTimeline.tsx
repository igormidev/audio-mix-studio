import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AudioLines, RotateCcw } from "lucide-react";
import type { MasterClip, MixProject } from "../shared/types";
import {
  masterTimelineClips,
  masterTimelineDuration,
  masterToTimelineTime,
  timelineToMasterTime,
} from "../domain/project";
import { clock, secondsLabel } from "./format";
import { Waveform } from "./Waveform";

interface CutSelection {
  pointerId: number;
  start: number;
  end: number;
  startX: number;
  moved: boolean;
}
interface RestoreMenu {
  segmentId: string;
  x: number;
  y: number;
}

export const MasterTimeline = memo(function MasterTimeline({
  project,
  duration,
  position,
  active,
  following,
  mode,
  disabled,
  onSeek,
  onCut,
  onCutStart,
  onRestore,
}: {
  project: MixProject;
  clips?: MasterClip[];
  duration: number;
  position: number;
  active: boolean;
  following: boolean;
  mode: "seek" | "cut";
  disabled: boolean;
  onSeek: (seconds: number) => void;
  onCut: (start: number, end: number) => void;
  onCutStart?: () => void;
  onRestore: (segmentId: string) => void;
}) {
  const clips = useMemo(() => masterTimelineClips(project), [project]);
  const visualDuration = useMemo(
    () => masterTimelineDuration(project),
    [project],
  );
  const tracks = useMemo(
    () => new Map(project.tracks.map((track) => [track.id, track])),
    [project.tracks],
  );
  const groups = useMemo(
    () =>
      new Map(
        project.groups.map((group, index) => [group.id, { group, index }]),
      ),
    [project.groups],
  );
  const visualPosition = masterToTimelineTime(clips, position);
  const scroll = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const anchor = useRef<{ fraction: number; pixel: number } | null>(null);
  const selectionRef = useRef<CutSelection | null>(null);
  const [selection, setSelection] = useState<CutSelection | null>(null);
  const [restoreMenu, setRestoreMenu] = useState<RestoreMenu | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{
    text: string;
    take: string;
    x: number;
    y: number;
  } | null>(null);
  const clearSelection = useCallback(() => {
    const previous = selectionRef.current;
    selectionRef.current = null;
    setSelection(null);
    if (previous && lane.current?.hasPointerCapture(previous.pointerId))
      lane.current.releasePointerCapture(previous.pointerId);
  }, []);
  useEffect(() => {
    clearSelection();
    setRestoreMenu(null);
    setTooltip(null);
  }, [active, disabled, mode, project, clearSelection]);
  useEffect(() => {
    if (!active) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearSelection();
      setTooltip(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [active, clearSelection]);
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
      clearSelection();
      anchor.current = {
        fraction:
          (element.scrollLeft + pixel) /
          (element.clientWidth * zoomRef.current),
        pixel,
      };
      zoomRef.current = bounded;
      setZoom(bounded);
      setTooltip(null);
      setRestoreMenu(null);
    };
    const wheel = (event: WheelEvent) => {
      if (!visualDuration || document.querySelector('[role="dialog"]')) return;
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
  }, [active, visualDuration, clearSelection]);
  useEffect(() => {
    const element = scroll.current;
    if (!element || !following || !visualDuration || selectionRef.current)
      return;
    const x = (visualPosition / visualDuration) * element.clientWidth * zoom;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth)
      element.scrollLeft = Math.max(0, x - element.clientWidth * 0.15);
  }, [visualPosition, following, visualDuration, zoom]);
  useLayoutEffect(() => {
    const element = menuElement.current;
    if (!restoreMenu || !element) return;
    const bounds = element.getBoundingClientRect();
    const x = Math.max(
      8,
      Math.min(innerWidth - bounds.width - 8, restoreMenu.x),
    );
    const y = Math.max(
      8,
      Math.min(innerHeight - bounds.height - 8, restoreMenu.y),
    );
    if (x !== restoreMenu.x || y !== restoreMenu.y)
      setRestoreMenu({ ...restoreMenu, x, y });
    element
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [restoreMenu]);
  useEffect(() => {
    if (!restoreMenu) return;
    const pointer = (event: PointerEvent) => {
      if (!menuElement.current?.contains(event.target as Node))
        setRestoreMenu(null);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRestoreMenu(null);
        menuTrigger.current?.focus({ preventScroll: true });
      }
      if (event.key === "Tab") setRestoreMenu(null);
    };
    const blur = () => setRestoreMenu(null);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keys);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("blur", blur);
    };
  }, [restoreMenu]);

  const visualTimeAt = (clientX: number) => {
    const bounds = lane.current?.getBoundingClientRect();
    if (!bounds?.width) return 0;
    return Math.max(
      0,
      Math.min(
        visualDuration,
        ((clientX - bounds.left) / bounds.width) * visualDuration,
      ),
    );
  };
  const showRestoreMenu = (
    segmentId: string,
    x: number,
    y: number,
    trigger: HTMLElement,
  ) => {
    if (!active || disabled) return;
    clearSelection();
    setTooltip(null);
    menuTrigger.current = trigger;
    setRestoreMenu({ segmentId, x, y });
  };
  const showTooltip = (element: HTMLElement, text: string, take: string) => {
    if (selectionRef.current || restoreMenu) return;
    const bounds = element.getBoundingClientRect();
    setTooltip({
      text,
      take,
      x: Math.max(
        160,
        Math.min(innerWidth - 160, bounds.left + bounds.width / 2),
      ),
      y: bounds.top - 8,
    });
  };
  const selectionStart = selection
    ? Math.min(selection.start, selection.end)
    : 0;
  const selectionEnd = selection ? Math.max(selection.start, selection.end) : 0;
  return (
    <div
      className="master-timeline"
      ref={scroll}
      data-zoom={zoom.toFixed(3)}
      data-mode={mode}
      data-cut-selecting={!!selection}
      data-visual-duration={visualDuration}
      aria-label={`Master timeline · ${mode === "cut" ? "drag to cut audio · " : ""}scroll or pinch to zoom`}
      onScroll={() => {
        setTooltip(null);
        setRestoreMenu(null);
      }}
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
                <span key={index}>
                  {clock((visualDuration * index) / count)}
                </span>
              );
            },
          )}
        </div>
        <div
          className="master-clips"
          ref={lane}
          onPointerDown={(event) => {
            if (
              mode !== "cut" ||
              disabled ||
              !active ||
              !visualDuration ||
              event.button !== 0
            )
              return;
            event.preventDefault();
            onCutStart?.();
            setTooltip(null);
            setRestoreMenu(null);
            const time = visualTimeAt(event.clientX);
            const next = {
              pointerId: event.pointerId,
              start: time,
              end: time,
              startX: event.clientX,
              moved: false,
            };
            selectionRef.current = next;
            setSelection(next);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const previous = selectionRef.current;
            if (!previous || previous.pointerId !== event.pointerId) return;
            event.preventDefault();
            const viewport = scroll.current;
            if (viewport) {
              const bounds = viewport.getBoundingClientRect();
              if (event.clientX < bounds.left + 24) viewport.scrollLeft -= 12;
              if (event.clientX > bounds.right - 24) viewport.scrollLeft += 12;
            }
            const next = {
              ...previous,
              end: visualTimeAt(event.clientX),
              moved:
                previous.moved ||
                Math.abs(event.clientX - previous.startX) >= 3,
            };
            selectionRef.current = next;
            setSelection(next);
          }}
          onPointerUp={(event) => {
            const selected = selectionRef.current;
            if (!selected || selected.pointerId !== event.pointerId) return;
            event.preventDefault();
            event.stopPropagation();
            const end = visualTimeAt(event.clientX);
            clearSelection();
            if (selected.moved && Math.abs(end - selected.start) >= 1 / 48000)
              onCut(
                Math.min(selected.start, end),
                Math.max(selected.start, end),
              );
          }}
          onPointerCancel={clearSelection}
          onLostPointerCapture={clearSelection}
          onClick={(event) => {
            if (mode === "cut" || disabled || !active || !duration) return;
            onSeek(timelineToMasterTime(clips, visualTimeAt(event.clientX)));
          }}
        >
          {clips.length ? (
            clips.map((clip) => {
              const track = tracks.get(clip.trackId)!;
              const sentence = groups.get(clip.groupId);
              const sentenceNumber = (sentence?.index ?? 0) + 1;
              const text = sentence?.group.text || clip.text;
              const excluded = !!clip.excluded;
              return (
                <div
                  className={`master-clip${excluded ? " excluded" : ""}`}
                  key={clip.id}
                  data-segment-id={clip.id}
                  data-excluded={excluded}
                  data-visual-offset={clip.offset}
                  data-playback-offset={clip.playbackOffset}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  aria-label={`Sentence ${sentenceNumber}${excluded ? ", excluded" : ""}: ${text}`}
                  aria-haspopup={excluded ? "menu" : undefined}
                  aria-expanded={
                    excluded ? restoreMenu?.segmentId === clip.id : undefined
                  }
                  style={{
                    left: `${(clip.offset / visualDuration) * 100}%`,
                    width: `${(clip.duration / visualDuration) * 100}%`,
                    color: excluded ? "var(--muted-wave)" : track.color,
                    background: excluded
                      ? "var(--muted-clip)"
                      : `${track.color}16`,
                  }}
                  onContextMenu={(event) => {
                    if (!excluded) return;
                    event.preventDefault();
                    event.stopPropagation();
                    showRestoreMenu(
                      clip.id,
                      event.clientX,
                      event.clientY,
                      event.currentTarget,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (disabled) return;
                    if (
                      excluded &&
                      (event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10"))
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      showRestoreMenu(
                        clip.id,
                        bounds.left + Math.min(bounds.width / 2, 120),
                        bounds.bottom + 4,
                        event.currentTarget,
                      );
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (duration) onSeek(clip.playbackOffset);
                    }
                  }}
                  onMouseEnter={(event) =>
                    showTooltip(
                      event.currentTarget,
                      text,
                      `${track.name}${excluded ? " · Excluded · right-click to restore" : ""}`,
                    )
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onFocus={(event) =>
                    showTooltip(
                      event.currentTarget,
                      text,
                      `${track.name}${excluded ? " · Excluded · right-click to restore" : ""}`,
                    )
                  }
                  onBlur={() => setTooltip(null)}
                >
                  <span className="master-clip-number">
                    {String(sentenceNumber).padStart(2, "0")}
                  </span>
                  <span className="master-clip-text">{clip.text}</span>
                  <Waveform
                    peaks={track.peaks}
                    start={clip.start / track.duration}
                    end={clip.end / track.duration}
                    bars={Math.max(
                      2,
                      Math.round((clip.duration / visualDuration) * 220 * zoom),
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
          {selection && (
            <div
              className="master-cut-selection"
              role="status"
              aria-label={`Cut selection: ${secondsLabel(selectionEnd - selectionStart)}`}
              data-start={selectionStart}
              data-end={selectionEnd}
              style={{
                left: `${(selectionStart / visualDuration) * 100}%`,
                width: `${((selectionEnd - selectionStart) / visualDuration) * 100}%`,
              }}
            >
              <span>{secondsLabel(selectionEnd - selectionStart)}</span>
            </div>
          )}
          {!!clips.length && (
            <div
              className="playhead"
              data-position={visualPosition}
              data-master-position={position}
              style={{
                left: `${visualDuration ? Math.min(100, (visualPosition / visualDuration) * 100) : 0}%`,
              }}
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
      {active &&
        restoreMenu &&
        createPortal(
          <div
            className="master-context-menu"
            ref={menuElement}
            role="menu"
            aria-label="Excluded audio"
            style={{ left: restoreMenu.x, top: restoreMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              role="menuitem"
              onClick={() => {
                onRestore(restoreMenu.segmentId);
                setRestoreMenu(null);
                menuTrigger.current?.focus({ preventScroll: true });
              }}
            >
              <RotateCcw size={14} />
              Restore audio
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
});
