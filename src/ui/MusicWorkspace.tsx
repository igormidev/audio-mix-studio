import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent } from "react";
import {
  AudioLines,
  Diamond,
  GripVertical,
  Minus,
  Music2,
  Plus,
  Trash2,
  Volume2,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  AudioTrack,
  FadeCurve,
  MasterClip,
  MixClipSettings,
  MixLane,
  MixPlacement,
  MixProject,
} from "../shared/types";
import { masterClips, setGroupSpeed } from "../domain/project";
import {
  addMixKeyframe,
  addMixLane,
  addMixPlacement,
  mixDuration,
  moveMixLane,
  outputTimeAtPlacement,
  placementDuration,
  placementRenderClips,
  removeMixKeyframe,
  removeMixLane,
  removeMixPlacement,
  soundMix,
  sourceTimeAtPlacement,
  updateMixKeyframe,
  updateMixPlacement,
} from "../domain/soundMix";
import { clock } from "./format";
import { Waveform } from "./Waveform";
import "./music-workspace.css";

const HEADER_WIDTH = 154;
const CLIP_MIME = "application/x-mix-placement";
const SOURCE_MIME = "application/x-mix-source";
const LANE_MIME = "application/x-mix-lane";
const roles = {
  voiceover: { title: "Voiceover", Icon: AudioLines },
  music: { title: "Music", Icon: Music2 },
  soundtrack: { title: "Sound effect", Icon: Waves },
};

export interface MusicWorkspaceProps {
  project: MixProject;
  busy: boolean;
  position: number;
  onSeek: (time: number) => void;
  onEdit: (update: (project: MixProject) => MixProject) => void;
  onAddAudio?: (lane: MixLane) => void;
  arrangementRequest?: {
    token: number;
    laneId: string;
    trackIds?: string[];
    at?: number;
  } | null;
  onArrangementHandled?: () => void;
}

type Selection =
  | { kind: "voiceover"; id: string }
  | { kind: "placement"; id: string; keyframeId?: string };

export function MusicWorkspace({
  project,
  busy,
  position,
  onSeek,
  onEdit,
  onAddAudio,
  arrangementRequest,
  onArrangementHandled,
}: MusicWorkspaceProps) {
  const mix = soundMix(project);
  const narration = useMemo(() => masterClips(project), [project]);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [addingLane, setAddingLane] = useState(false);
  const [deleteLane, setDeleteLane] = useState<MixLane | null>(null);
  const [staging, setStaging] = useState<{
    laneId: string;
    project: MixProject;
  } | null>(null);
  const handledArrangement = useRef(0);
  useEffect(() => {
    if (
      !arrangementRequest ||
      handledArrangement.current === arrangementRequest.token
    )
      return;
    handledArrangement.current = arrangementRequest.token;
    const lane = soundMix(project).lanes.find(
      (lane) => lane.id === arrangementRequest.laneId,
    );
    if (lane && lane.kind !== "voiceover") {
      let draft = project;
      let at = Math.max(0, arrangementRequest.at ?? 0);
      for (const id of arrangementRequest.trackIds ?? []) {
        const track = draft.tracks.find(
          (track) => track.id === id && track.role === lane.kind,
        );
        if (!track) continue;
        draft = addMixPlacement(draft, lane.id, id, at);
        at += track.duration;
      }
      setStaging({ laneId: lane.id, project: draft });
    }
    onArrangementHandled?.();
  }, [arrangementRequest, project, onArrangementHandled]);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const totalDuration = Math.max(10, mixDuration(project) + 3);
  const pixelsPerSecond =
    Math.max(0.0001, (width - HEADER_WIDTH - 24) / totalDuration) * zoom;
  const timelineWidth = Math.max(
    width - HEADER_WIDTH,
    totalDuration * pixelsPerSecond,
  );
  const placementsByLane = useMemo(() => {
    const result = new Map<string, MixPlacement[]>();
    for (const placement of mix.placements) {
      result.set(placement.laneId, [
        ...(result.get(placement.laneId) ?? []),
        placement,
      ]);
    }
    return result;
  }, [mix.placements]);
  const selectedPlacement =
    selection?.kind === "placement"
      ? mix.placements.find((placement) => placement.id === selection.id)
      : undefined;
  const selectedVoice =
    selection?.kind === "voiceover"
      ? narration.find((clip) => clip.id === selection.id)
      : undefined;
  const selectedKeyframe = selectedPlacement?.keyframes.find(
    (keyframe) =>
      selection?.kind === "placement" && keyframe.id === selection.keyframeId,
  );
  const selectedSource = project.tracks.find(
    (track) =>
      track.id === (selectedPlacement?.trackId ?? selectedVoice?.trackId),
  );
  const selectedSettings =
    selectedKeyframe?.settings ?? selectedPlacement?.settings;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const x = position * pixelsPerSecond;
    const visible = element.clientWidth - HEADER_WIDTH;
    if (x < element.scrollLeft || x > element.scrollLeft + visible - 16)
      element.scrollLeft = Math.max(0, x - Math.max(20, visible * 0.25));
  }, [position, pixelsPerSecond]);

  const edit = (update: (project: MixProject) => MixProject) => {
    if (!busy) {
      setError("");
      onEdit(update);
    }
  };
  const updateSettings = (patch: Partial<MixClipSettings>) => {
    if (!selectedPlacement || !selectedSettings) return;
    const settings = { ...selectedSettings, ...patch };
    edit((current) =>
      selectedKeyframe
        ? updateMixKeyframe(
            current,
            selectedPlacement.id,
            selectedKeyframe.id,
            { settings },
          )
        : updateMixPlacement(current, selectedPlacement.id, { settings }),
    );
  };
  const addKeyframe = () => {
    if (!selectedPlacement) return;
    const localTime = position - selectedPlacement.offset;
    const duration = placementDuration(project, selectedPlacement);
    if (localTime <= 0 || localTime >= duration) {
      setError(
        "Move the playhead inside the selected clip, then add a keyframe.",
      );
      return;
    }
    const sourceTime = sourceTimeAtPlacement(
      project,
      selectedPlacement,
      localTime,
    );
    const next = addMixKeyframe(project, selectedPlacement.id, sourceTime);
    const keyframe = soundMix(next)
      .placements.find((placement) => placement.id === selectedPlacement.id)
      ?.keyframes.find(
        (point) => Math.abs(point.time - sourceTime) < 1 / 48_000,
      );
    edit(() => next);
    if (keyframe)
      setSelection({
        kind: "placement",
        id: selectedPlacement.id,
        keyframeId: keyframe.id,
      });
  };
  const dropOnLane = (event: DragEvent<HTMLDivElement>, lane: MixLane) => {
    event.preventDefault();
    if (busy || lane.kind === "voiceover") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = Math.max(0, (event.clientX - rect.left) / pixelsPerSecond);
    const placementId = event.dataTransfer.getData(CLIP_MIME);
    const sourceId = event.dataTransfer.getData(SOURCE_MIME);
    if (placementId) {
      edit((current) =>
        updateMixPlacement(current, placementId, {
          laneId: lane.id,
          offset: snapTime(current, at),
        }),
      );
    } else if (sourceId) {
      edit((current) =>
        addMixPlacement(current, lane.id, sourceId, snapTime(current, at)),
      );
    }
  };

  return (
    <div className="music-workspace" data-full-take-drop="music">
      <div className="music-toolbar">
        <div className="music-toolbar-title">
          <span className="music-eyebrow">YOUR SOUND, TOGETHER</span>
          <strong>Arrange the atmosphere</strong>
        </div>
        <div className="music-toolbar-actions">
          <div
            className="music-zoom"
            role="group"
            aria-label="Zoom all mix tracks"
          >
            <button
              className="icon-button"
              aria-label="Zoom out mix tracks"
              onClick={() => setZoom((value) => Math.max(1, value / 1.5))}
              disabled={zoom <= 1}
            >
              <ZoomOut size={15} />
            </button>
            <button
              className="text-button"
              aria-label="Fit all mix tracks"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in mix tracks"
              onClick={() => setZoom((value) => Math.min(64, value * 1.5))}
              disabled={zoom >= 64}
            >
              <ZoomIn size={15} />
            </button>
          </div>
          <div className="music-add-lane-wrap">
            <button
              className="button secondary"
              disabled={busy}
              aria-expanded={addingLane}
              onClick={() => setAddingLane(!addingLane)}
            >
              <Plus size={14} />
              Add track
            </button>
            {addingLane && (
              <div className="music-add-menu">
                {(["music", "soundtrack"] as const).map((kind) => {
                  const { Icon, title } = roles[kind];
                  return (
                    <button
                      key={kind}
                      onClick={() => {
                        edit((current) => addMixLane(current, kind));
                        setAddingLane(false);
                      }}
                    >
                      <Icon size={18} />
                      <span>
                        {title} track
                        <small>
                          {kind === "music"
                            ? "A bed for your story"
                            : "Details that bring it to life"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="music-local-error" role="status">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss mix message"
            onClick={() => setError("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div
        className={`music-editor ${selection && (selectedPlacement || selectedVoice) ? "has-inspector" : ""}`}
      >
        <div className="music-timeline-scroll" ref={viewport}>
          <div
            className="music-timeline-grid"
            style={{ width: HEADER_WIDTH + timelineWidth }}
          >
            <div className="music-ruler-row">
              <div className="music-ruler-label">
                TRACKS <span>{mix.lanes.length}</span>
              </div>
              <TimeRuler
                duration={timelineWidth / pixelsPerSecond}
                pixelsPerSecond={pixelsPerSecond}
                onSeek={onSeek}
              />
            </div>
            <div
              className="music-playhead"
              style={{
                left:
                  HEADER_WIDTH +
                  Math.min(totalDuration, position) * pixelsPerSecond,
              }}
              aria-hidden="true"
            >
              <span />
            </div>
            {mix.lanes.map((lane) => {
              const { Icon } = roles[lane.kind];
              const placements = placementsByLane.get(lane.id) ?? [];
              return (
                <div
                  className={`music-lane music-lane-${lane.kind}`}
                  key={lane.id}
                >
                  <div
                    className="music-lane-header"
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(LANE_MIME))
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const id = event.dataTransfer.getData(LANE_MIME);
                      if (!id || id === lane.id) return;
                      event.preventDefault();
                      edit((current) =>
                        moveMixLane(
                          current,
                          id,
                          mix.lanes.findIndex((item) => item.id === lane.id),
                        ),
                      );
                    }}
                  >
                    <div
                      className="music-lane-name"
                      draggable={!busy}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(LANE_MIME, lane.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      title="Drag to reorder track"
                    >
                      <GripVertical size={12} className="music-grip" />
                      <Icon size={16} />
                      <strong>{lane.name}</strong>
                    </div>
                    <span className="music-lane-caption">
                      {lane.kind === "voiceover"
                        ? "Follows sentence choices"
                        : `${placements.length} ${placements.length === 1 ? "clip" : "clips"}`}
                    </span>
                    {lane.kind !== "voiceover" && (
                      <div className="music-lane-actions">
                        <button
                          className="music-lane-add"
                          aria-label={`Add audio to ${lane.name}`}
                          disabled={busy}
                          onClick={() =>
                            onAddAudio
                              ? onAddAudio(lane)
                              : setStaging({ laneId: lane.id, project })
                          }
                        >
                          <Plus size={13} />
                          Add audio
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${lane.name}`}
                          disabled={busy}
                          onClick={() => setDeleteLane(lane)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className="music-lane-content"
                    style={{
                      width: timelineWidth,
                      backgroundSize: `${tickInterval(pixelsPerSecond) * pixelsPerSecond}px 100%`,
                    }}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget)
                        onSeek(
                          Math.max(
                            0,
                            (event.clientX -
                              event.currentTarget.getBoundingClientRect()
                                .left) /
                              pixelsPerSecond,
                          ),
                        );
                    }}
                    onDragOver={(event) => {
                      if (
                        lane.kind !== "voiceover" &&
                        (event.dataTransfer.types.includes(CLIP_MIME) ||
                          event.dataTransfer.types.includes(SOURCE_MIME))
                      )
                        event.preventDefault();
                    }}
                    onDrop={(event) => dropOnLane(event, lane)}
                  >
                    {lane.kind === "voiceover"
                      ? narration.map((clip) => {
                          const source = project.tracks.find(
                            (track) => track.id === clip.trackId,
                          );
                          return (
                            source && (
                              <VoiceClip
                                key={clip.id}
                                source={source}
                                clip={clip}
                                pixelsPerSecond={pixelsPerSecond}
                                selected={selectedVoice?.id === clip.id}
                                onSelect={() =>
                                  setSelection({
                                    kind: "voiceover",
                                    id: clip.id,
                                  })
                                }
                              />
                            )
                          );
                        })
                      : placements.map((placement) => {
                          const source = project.tracks.find(
                            (track) => track.id === placement.trackId,
                          );
                          return (
                            source && (
                              <PlacementClip
                                key={placement.id}
                                source={source}
                                placement={placement}
                                project={project}
                                pixelsPerSecond={pixelsPerSecond}
                                selected={
                                  selectedPlacement?.id === placement.id
                                }
                                keyframeId={
                                  selection?.kind === "placement"
                                    ? selection.keyframeId
                                    : undefined
                                }
                                disabled={busy}
                                onSelect={(keyframeId) =>
                                  setSelection({
                                    kind: "placement",
                                    id: placement.id,
                                    keyframeId,
                                  })
                                }
                                onSeek={onSeek}
                                onMove={(offset) =>
                                  edit((current) =>
                                    updateMixPlacement(current, placement.id, {
                                      offset: snapTime(
                                        current,
                                        offset,
                                        placement.id,
                                      ),
                                    }),
                                  )
                                }
                              />
                            )
                          );
                        })}
                    {lane.kind !== "voiceover" && placements.length === 0 && (
                      <button
                        className="music-empty-lane"
                        disabled={busy}
                        onClick={() =>
                          onAddAudio
                            ? onAddAudio(lane)
                            : setStaging({ laneId: lane.id, project })
                        }
                      >
                        <Plus size={17} />
                        <span>
                          Add{" "}
                          {lane.kind === "music" ? "music" : "a sound effect"}{" "}
                          to this track
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="music-timeline-hint">
            <GripVertical size={12} />
            Drag track names to reorder. Drag clips to arrange.{" "}
            <Diamond size={11} />
            Keyframes shape each section.
          </div>
        </div>
        {(selectedPlacement || selectedVoice) && (
          <aside
            className="music-inspector"
            aria-label="Selected audio settings"
          >
            <div className="music-inspector-heading">
              <span className="music-eyebrow">
                {selectedVoice
                  ? "VOICEOVER"
                  : selectedKeyframe
                    ? "KEYFRAME SECTION"
                    : "CLIP SETTINGS"}
              </span>
              <button
                className="icon-button"
                aria-label="Close audio settings"
                onClick={() => setSelection(null)}
              >
                <X size={15} />
              </button>
            </div>
            <h3 title={selectedSource?.name}>{selectedSource?.name}</h3>
            {selectedVoice ? (
              <>
                <p className="music-inspector-description">
                  Change this sentence’s speed. The following sentences snap
                  into place.
                </p>
                <SpeedControl
                  key={`${selectedVoice.groupId}:${selectedVoice.speed}`}
                  speed={selectedVoice.speed ?? 1}
                  disabled={busy}
                  onChange={(speed) =>
                    edit((current) =>
                      setGroupSpeed(current, selectedVoice.groupId, speed),
                    )
                  }
                />
                <div className="music-inspector-note">
                  <AudioLines size={16} />
                  Choose takes and edit narration in Sentence choices.
                </div>
              </>
            ) : (
              selectedPlacement &&
              selectedSettings && (
                <>
                  <div className="music-section-navigation">
                    <label>
                      Editing section
                      <select
                        aria-label="Keyframe section"
                        value={selectedKeyframe?.id ?? ""}
                        onChange={(event) =>
                          setSelection({
                            kind: "placement",
                            id: selectedPlacement.id,
                            keyframeId: event.target.value || undefined,
                          })
                        }
                      >
                        <option value="">
                          Start →{" "}
                          {selectedPlacement.keyframes.length
                            ? "first keyframe"
                            : "end"}
                        </option>
                        {selectedPlacement.keyframes.map((keyframe, index) => (
                          <option value={keyframe.id} key={keyframe.id}>
                            {String.fromCharCode(65 + index)} →{" "}
                            {index === selectedPlacement.keyframes.length - 1
                              ? "end"
                              : String.fromCharCode(66 + index)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="music-section-range">
                      <span>Section on timeline</span>
                      <strong>
                        {clock(
                          selectedPlacement.offset +
                            (selectedKeyframe
                              ? outputTimeAtPlacement(
                                  project,
                                  selectedPlacement,
                                  selectedKeyframe.time,
                                )
                              : 0),
                          true,
                        )}
                        {" → "}
                        {clock(
                          selectedPlacement.offset +
                            outputTimeAtPlacement(
                              project,
                              selectedPlacement,
                              selectedPlacement.keyframes.find(
                                (point) =>
                                  point.time > (selectedKeyframe?.time ?? 0),
                              )?.time ??
                                selectedPlacement.end - selectedPlacement.start,
                            ),
                          true,
                        )}
                      </strong>
                    </div>
                    {selectedKeyframe && (
                      <label className="music-keyframe-position">
                        Keyframe at
                        <span>
                          <input
                            key={`${selectedKeyframe.id}:${selectedKeyframe.time}`}
                            type="number"
                            min={selectedPlacement.offset + 0.01}
                            max={
                              selectedPlacement.offset +
                              placementDuration(project, selectedPlacement) -
                              0.01
                            }
                            step="0.01"
                            defaultValue={Number(
                              (
                                selectedPlacement.offset +
                                outputTimeAtPlacement(
                                  project,
                                  selectedPlacement,
                                  selectedKeyframe.time,
                                )
                              ).toFixed(2),
                            )}
                            aria-label="Keyframe time on timeline"
                            disabled={busy}
                            onBlur={(event) => {
                              const at = Number(event.currentTarget.value);
                              const relative = at - selectedPlacement.offset;
                              if (
                                !Number.isFinite(at) ||
                                relative <= 0 ||
                                relative >=
                                  placementDuration(project, selectedPlacement)
                              )
                                return;
                              const sourceTime = sourceTimeAtPlacement(
                                project,
                                selectedPlacement,
                                relative,
                              );
                              edit((current) =>
                                updateMixKeyframe(
                                  current,
                                  selectedPlacement.id,
                                  selectedKeyframe.id,
                                  { time: sourceTime },
                                ),
                              );
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter")
                                event.currentTarget.blur();
                            }}
                          />
                          s
                        </span>
                      </label>
                    )}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={addKeyframe}
                    >
                      <Diamond size={13} />
                      Keyframe at playhead
                    </button>
                    {selectedKeyframe && (
                      <button
                        className="text-button music-delete-keyframe"
                        disabled={busy}
                        onClick={() => {
                          edit((current) =>
                            removeMixKeyframe(
                              current,
                              selectedPlacement.id,
                              selectedKeyframe.id,
                            ),
                          );
                          setSelection({
                            kind: "placement",
                            id: selectedPlacement.id,
                          });
                        }}
                      >
                        <Minus size={12} />
                        Remove this keyframe
                      </button>
                    )}
                  </div>
                  <SpeedControl
                    key={`${selectedPlacement.id}:${selectedKeyframe?.id}:${selectedSettings.speed}`}
                    speed={selectedSettings.speed}
                    disabled={busy}
                    onChange={(speed) => updateSettings({ speed })}
                  />
                  <ValueControl
                    label="Volume"
                    value={selectedSettings.volume * 100}
                    min={0}
                    max={200}
                    step={1}
                    unit="%"
                    disabled={busy}
                    onChange={(value) =>
                      updateSettings({ volume: value / 100 })
                    }
                    icon={<Volume2 size={14} />}
                  />
                  <FadeEditor
                    kind="in"
                    settings={selectedSettings}
                    disabled={busy}
                    onChange={updateSettings}
                  />
                  <FadeEditor
                    kind="out"
                    settings={selectedSettings}
                    disabled={busy}
                    onChange={updateSettings}
                  />
                  <label className="music-placement-time">
                    Clip starts at{" "}
                    <input
                      type="number"
                      aria-label="Clip start on timeline"
                      min="0"
                      max="604800"
                      step="0.01"
                      value={Number(selectedPlacement.offset.toFixed(2))}
                      disabled={busy}
                      onChange={(event) => {
                        const offset = Number(event.target.value);
                        if (Number.isFinite(offset) && offset >= 0)
                          edit((current) =>
                            updateMixPlacement(current, selectedPlacement.id, {
                              offset,
                            }),
                          );
                      }}
                    />
                    <span>s</span>
                  </label>
                  <button
                    className="music-remove-clip"
                    disabled={busy}
                    onClick={() => {
                      edit((current) =>
                        removeMixPlacement(current, selectedPlacement.id),
                      );
                      setSelection(null);
                    }}
                  >
                    <Trash2 size={14} />
                    Remove clip from timeline
                  </button>
                </>
              )
            )}
          </aside>
        )}
      </div>
      {staging && (
        <PlacementDialog
          project={staging.project}
          laneId={staging.laneId}
          onClose={() => setStaging(null)}
          onSave={(next) => {
            edit((current) => ({ ...current, soundMix: soundMix(next) }));
            setStaging(null);
          }}
        />
      )}
      {deleteLane && (
        <div className="modal-backdrop" onClick={() => setDeleteLane(null)}>
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-mix-track-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-symbol">
              <Trash2 size={25} />
            </div>
            <h2 id="delete-mix-track-title">Delete {deleteLane.name}?</h2>
            <p>
              Its clips will be removed from the timeline. The original audio
              stays in your library. You can undo this change.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setDeleteLane(null)}
              >
                Keep track
              </button>
              <button
                className="button primary"
                onClick={() => {
                  edit((current) => removeMixLane(current, deleteLane.id));
                  setDeleteLane(null);
                }}
              >
                Delete track
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function tickInterval(pixelsPerSecond: number) {
  return (
    [
      0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600, 7200,
      14400, 43200, 86400, 172800, 604800,
    ].find((value) => value * pixelsPerSecond >= 68) ?? 604800
  );
}

function TimeRuler({
  duration,
  pixelsPerSecond,
  onSeek,
}: {
  duration: number;
  pixelsPerSecond: number;
  onSeek: (time: number) => void;
}) {
  const interval = tickInterval(pixelsPerSecond);
  const count = Math.ceil(duration / interval);
  return (
    <div
      className="music-ruler"
      style={{ width: duration * pixelsPerSecond }}
      onPointerDown={(event) =>
        onSeek(
          Math.max(
            0,
            (event.clientX - event.currentTarget.getBoundingClientRect().left) /
              pixelsPerSecond,
          ),
        )
      }
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} style={{ left: index * interval * pixelsPerSecond }}>
          {clock(index * interval, interval < 1)}
        </span>
      ))}
    </div>
  );
}

function snapTime(project: MixProject, at: number, ignorePlacementId?: string) {
  const points = [
    0,
    ...masterClips(project).flatMap((clip) => [
      clip.offset,
      clip.offset + clip.duration,
    ]),
    ...soundMix(project)
      .placements.filter((placement) => placement.id !== ignorePlacementId)
      .flatMap((placement) => [
        placement.offset,
        placement.offset + placementDuration(project, placement),
      ]),
  ];
  const nearest = points.reduce(
    (best, point) =>
      Math.abs(point - at) < Math.abs(best - at) ? point : best,
    points[0],
  );
  return (
    Math.round(
      Math.max(0, Math.abs(nearest - at) < 0.12 ? nearest : at) * 48_000,
    ) / 48_000
  );
}

function VoiceClip({
  source,
  clip,
  pixelsPerSecond,
  selected,
  onSelect,
}: {
  source: AudioTrack;
  clip: MasterClip;
  pixelsPerSecond: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`music-clip voice-clip ${selected ? "selected" : ""}`}
      style={
        {
          left: clip.offset * pixelsPerSecond,
          width: Math.max(3, clip.duration * pixelsPerSecond),
          "--clip-color": source.color,
        } as React.CSSProperties
      }
      title={`${clip.text} · ${clip.speed ?? 1}×`}
      onClick={onSelect}
      aria-label={`Edit voiceover speed: ${clip.text}`}
    >
      <span className="music-clip-title">{clip.text}</span>
      <Waveform
        peaks={source.peaks}
        start={clip.start / source.duration}
        end={clip.end / source.duration}
        color={source.color}
        bars={Math.min(
          500,
          Math.max(12, Math.ceil((clip.duration * pixelsPerSecond) / 3)),
        )}
      />
      <span className="music-clip-foot">{clip.speed ?? 1}×</span>
    </button>
  );
}

function PlacementClip({
  source,
  placement,
  project,
  pixelsPerSecond,
  selected,
  keyframeId,
  disabled,
  onSelect,
  onSeek,
  onMove,
}: {
  source: AudioTrack;
  placement: MixPlacement;
  project: MixProject;
  pixelsPerSecond: number;
  selected: boolean;
  keyframeId?: string;
  disabled: boolean;
  onSelect: (keyframeId?: string) => void;
  onSeek: (time: number) => void;
  onMove: (offset: number) => void;
}) {
  const pieces = placementRenderClips(project, placement);
  const duration = placementDuration(project, placement);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<{ x: number; offset: number; moved: boolean } | null>(
    null,
  );
  const didDrag = useRef(false);
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      disabled ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    drag.current = { x: event.clientX, offset: placement.offset, moved: false };
    didDrag.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const wasMoved = drag.current.moved;
    const value = Math.max(
      0,
      drag.current.offset + (event.clientX - drag.current.x) / pixelsPerSecond,
    );
    drag.current = null;
    setDragOffset(null);
    didDrag.current = wasMoved;
    if (wasMoved) onMove(value);
  };
  return (
    <div
      className={`music-clip placement-clip ${selected ? "selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${source.name}`}
      title={`${source.name} · drag to move`}
      style={
        {
          left: (dragOffset ?? placement.offset) * pixelsPerSecond,
          width: Math.max(14, duration * pixelsPerSecond),
          "--clip-color": source.color,
        } as React.CSSProperties
      }
      onPointerDown={startDrag}
      onPointerMove={(event) => {
        if (!drag.current) return;
        if (Math.abs(event.clientX - drag.current.x) > 3)
          drag.current.moved = true;
        if (drag.current.moved)
          setDragOffset(
            Math.max(
              0,
              drag.current.offset +
                (event.clientX - drag.current.x) / pixelsPerSecond,
            ),
          );
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        drag.current = null;
        setDragOffset(null);
      }}
      onClick={() => {
        if (!didDrag.current) onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
        if (
          !disabled &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          onMove(
            Math.max(
              0,
              placement.offset +
                (event.key === "ArrowRight" ? 1 : -1) *
                  (event.shiftKey ? 1 : 0.25),
            ),
          );
        }
      }}
    >
      <span className="music-clip-title">{source.name}</span>
      <div className="music-clip-waves">
        {pieces.map((piece) => (
          <div
            key={piece.id}
            className="music-wave-piece"
            style={{
              left: (piece.offset - placement.offset) * pixelsPerSecond,
              width: piece.duration * pixelsPerSecond,
            }}
          >
            <Waveform
              peaks={source.peaks}
              start={piece.start / source.duration}
              end={piece.end / source.duration}
              color={source.color}
              bars={Math.min(
                500,
                Math.max(8, Math.ceil((piece.duration * pixelsPerSecond) / 3)),
              )}
            />
          </div>
        ))}
      </div>
      <span className="music-clip-foot">
        {placement.settings.speed}× ·{" "}
        {Math.round(placement.settings.volume * 100)}%
      </span>
      {placement.keyframes.map((keyframe, index) => {
        const output = outputTimeAtPlacement(project, placement, keyframe.time);
        return (
          <button
            key={keyframe.id}
            className={`music-keyframe ${keyframe.id === keyframeId ? "active" : ""}`}
            style={{ left: output * pixelsPerSecond }}
            title={`Keyframe ${String.fromCharCode(65 + index)} · ${clock(placement.offset + output, true)}`}
            aria-label={`Keyframe ${String.fromCharCode(65 + index)} for ${source.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(keyframe.id);
              onSeek(placement.offset + output);
            }}
          >
            <Diamond size={14} fill="currentColor" />
            <span>{String.fromCharCode(65 + index)}</span>
          </button>
        );
      })}
    </div>
  );
}

function SpeedControl({
  speed,
  disabled,
  onChange,
}: {
  speed: number;
  disabled: boolean;
  onChange: (speed: number) => void;
}) {
  return (
    <div className="music-speed-control">
      <div className="music-control-heading">
        <strong>Speed</strong>
        <span>Pitch preserved</span>
      </div>
      <ValueControl
        label="Playback speed"
        hideLabel
        value={speed}
        min={0.5}
        max={2}
        step={0.01}
        unit="×"
        disabled={disabled}
        onChange={onChange}
      />
      <div className="music-speed-buttons">
        <button
          disabled={disabled || speed <= 0.5}
          aria-label="Decrease speed by one percent"
          onClick={() =>
            onChange(Math.max(0.5, Math.round((speed - 0.01) * 100) / 100))
          }
        >
          <Minus size={12} />
          1%
        </button>
        <button
          className="music-speed-reset"
          disabled={disabled}
          onClick={() => onChange(1)}
        >
          Reset 1×
        </button>
        <button
          disabled={disabled || speed >= 2}
          aria-label="Increase speed by one percent"
          onClick={() =>
            onChange(Math.min(2, Math.round((speed + 0.01) * 100) / 100))
          }
        >
          1%
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function ValueControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
  hideLabel,
  icon,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
  hideLabel?: boolean;
  icon?: React.ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (candidate: number) => {
    const next =
      Math.round(Math.min(max, Math.max(min, candidate)) / step) * step;
    setDraft(next);
    if (next !== value) onChange(next);
  };
  return (
    <div className="music-value-control">
      {!hideLabel && (
        <label className="music-control-heading">
          {icon}
          <strong>{label}</strong>
        </label>
      )}
      <div className="music-value-inputs">
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(Number(event.target.value))}
          onPointerUp={(event) => commit(Number(event.currentTarget.value))}
          onKeyUp={(event) => commit(Number(event.currentTarget.value))}
          onBlur={() => commit(draft)}
        />
        <span className="music-number-wrap">
          <input
            aria-label={`${label} value`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(draft.toFixed(2))}
            disabled={disabled}
            onChange={(event) => setDraft(Number(event.target.value))}
            onBlur={() => commit(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(draft);
            }}
          />
          <span>{unit}</span>
        </span>
      </div>
    </div>
  );
}

function FadeEditor({
  kind,
  settings,
  disabled,
  onChange,
}: {
  kind: "in" | "out";
  settings: MixClipSettings;
  disabled: boolean;
  onChange: (patch: Partial<MixClipSettings>) => void;
}) {
  const incoming = kind === "in";
  const duration = incoming ? settings.fadeInMs : settings.fadeOutMs;
  const start = incoming ? settings.fadeInStartMs : settings.fadeOutStartMs;
  const curve = incoming ? settings.fadeInCurve : settings.fadeOutCurve;
  const power = incoming ? settings.fadeInPower : settings.fadeOutPower;
  const set = (
    field: "Ms" | "StartMs" | "Curve" | "Power",
    value: number | FadeCurve,
  ) => onChange({ [`fade${incoming ? "In" : "Out"}${field}`]: value });
  return (
    <section className="music-fade-editor">
      <div className="music-control-heading">
        <strong>Fade {kind}</strong>
        <span>{duration ? `${(duration / 1000).toFixed(2)} s` : "Off"}</span>
      </div>
      <ValueControl
        label={`Fade ${kind} duration`}
        hideLabel
        value={duration / 1000}
        min={0}
        max={30}
        step={0.01}
        unit="s"
        disabled={disabled}
        onChange={(value) => set("Ms", Math.round(value * 1000))}
      />
      <label className="music-fade-offset">
        {incoming ? "Start after section begins" : "End before section ends"}
        <span>
          <input
            aria-label={`Fade ${kind} offset`}
            type="number"
            min="0"
            max="3600"
            step="0.01"
            value={Number((start / 1000).toFixed(2))}
            disabled={disabled}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value >= 0 && value <= 3600)
                set("StartMs", Math.round(value * 1000));
            }}
          />
          s
        </span>
      </label>
      <div
        className="music-curve-options"
        role="group"
        aria-label={`Fade ${kind} curve`}
      >
        {(["linear", "ease-in", "ease-out", "s-curve", "custom"] as const).map(
          (value) => (
            <button
              key={value}
              disabled={disabled}
              className={curve === value ? "active" : ""}
              title={value === "custom" ? "Custom curve" : value}
              aria-label={`Fade ${kind} ${value} curve`}
              aria-pressed={curve === value}
              onClick={() => set("Curve", value)}
            >
              <CurveGraph curve={value} power={power} reverse={!incoming} />
              <small>
                {
                  {
                    linear: "Linear",
                    "ease-in": "Slow",
                    "ease-out": "Fast",
                    "s-curve": "Smooth",
                    custom: "Custom",
                  }[value]
                }
              </small>
            </button>
          ),
        )}
      </div>
      {curve === "custom" && (
        <ValueControl
          label={`Fade ${kind} curve shape`}
          value={power}
          min={0.1}
          max={5}
          step={0.1}
          unit=""
          disabled={disabled}
          onChange={(value) => set("Power", value)}
        />
      )}
    </section>
  );
}

function CurveGraph({
  curve,
  power,
  reverse,
}: {
  curve: FadeCurve;
  power: number;
  reverse: boolean;
}) {
  const points = Array.from({ length: 25 }, (_, i) => {
    const x = i / 24;
    const y =
      curve === "ease-in"
        ? x * x
        : curve === "ease-out"
          ? 1 - (1 - x) ** 2
          : curve === "s-curve"
            ? x * x * (3 - 2 * x)
            : curve === "custom"
              ? x ** power
              : x;
    return `${2 + x * 32},${2 + (reverse ? y : 1 - y) * 22}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 36 27" aria-hidden="true">
      <path d="M2 2V24H34" fill="none" stroke="currentColor" opacity="0.25" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function PlacementDialog({
  project: original,
  laneId,
  onClose,
  onSave,
}: {
  project: MixProject;
  laneId: string;
  onClose: () => void;
  onSave: (project: MixProject) => void;
}) {
  const [project, setProject] = useState(original);
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lane = soundMix(project).lanes.find((item) => item.id === laneId)!;
  const placements = soundMix(project).placements.filter(
    (placement) => placement.laneId === laneId,
  );
  const library = project.tracks.filter((track) => track.role === lane.kind);
  const duration = Math.max(10, mixDuration(project) + 3);
  const pixelsPerSecond = Math.max(0.0001, 670 / duration) * zoom;
  const timelineWidth = Math.max(670, duration * pixelsPerSecond);
  const end = placements.reduce(
    (time, placement) =>
      Math.max(time, placement.offset + placementDuration(project, placement)),
    0,
  );
  const { Icon } = roles[lane.kind];
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal music-placement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-audio-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="music-eyebrow">ARRANGE YOUR AUDIO</span>
            <h2 id="place-audio-title">
              <Icon size={23} />
              {lane.name}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close track arranger"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <p>
          Drag an audio file onto the track, then slide it into place. Your
          changes apply when you save.
        </p>
        <div className="music-staging-heading">
          <strong>Track arrangement</strong>
          <div className="music-zoom">
            <button
              className="icon-button"
              aria-label="Zoom out track arranger"
              onClick={() => setZoom(Math.max(1, zoom / 1.5))}
            >
              <ZoomOut size={14} />
            </button>
            <button className="text-button" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in track arranger"
              onClick={() => setZoom(Math.min(64, zoom * 1.5))}
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>
        <div className="music-staging-scroll">
          <div style={{ width: timelineWidth }}>
            <TimeRuler
              duration={timelineWidth / pixelsPerSecond}
              pixelsPerSecond={pixelsPerSecond}
              onSeek={() => undefined}
            />
            <div
              className={`music-staging-lane music-lane-${lane.kind}`}
              style={{
                width: timelineWidth,
                backgroundSize: `${tickInterval(pixelsPerSecond) * pixelsPerSecond}px 100%`,
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(SOURCE_MIME))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData(SOURCE_MIME);
                if (!sourceId) return;
                const at = Math.max(
                  0,
                  (event.clientX -
                    event.currentTarget.getBoundingClientRect().left) /
                    pixelsPerSecond,
                );
                setProject((current) =>
                  addMixPlacement(
                    current,
                    laneId,
                    sourceId,
                    snapTime(current, at),
                  ),
                );
              }}
            >
              {placements.map((placement) => {
                const source = project.tracks.find(
                  (track) => track.id === placement.trackId,
                );
                return (
                  source && (
                    <PlacementClip
                      key={placement.id}
                      source={source}
                      placement={placement}
                      project={project}
                      pixelsPerSecond={pixelsPerSecond}
                      selected={selectedId === placement.id}
                      disabled={false}
                      onSelect={() => setSelectedId(placement.id)}
                      onSeek={() => undefined}
                      onMove={(offset) =>
                        setProject((current) =>
                          updateMixPlacement(current, placement.id, {
                            offset: snapTime(current, offset, placement.id),
                          }),
                        )
                      }
                    />
                  )
                );
              })}
              {!placements.length && (
                <div className="music-staging-empty">
                  <Plus size={21} />
                  Drop audio here
                </div>
              )}
            </div>
          </div>
        </div>
        {selectedId &&
          placements.some((placement) => placement.id === selectedId) && (
            <div className="music-staging-selection">
              <span>Clip selected · drag to reposition</span>
              <button
                className="text-button"
                onClick={() => {
                  setProject((current) =>
                    removeMixPlacement(current, selectedId),
                  );
                  setSelectedId(null);
                }}
              >
                <Trash2 size={13} />
                Remove from track
              </button>
            </div>
          )}
        <div className="music-library-heading">
          <h3>Your {lane.kind === "music" ? "music" : "sound effects"}</h3>
          <span>{library.length} imported</span>
        </div>
        <div className="music-staging-library">
          {library.map((track) => (
            <div
              className="music-library-source"
              key={track.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(SOURCE_MIME, track.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <GripVertical size={14} />
              <span className="music-library-icon">
                <Icon size={20} />
              </span>
              <div>
                <strong title={track.name}>{track.name}</strong>
                <span>{clock(track.duration)} · drag onto track</span>
                <Waveform peaks={track.peaks} color={track.color} bars={75} />
              </div>
              <button
                className="icon-button"
                aria-label={`Add ${track.name} to ${lane.name}`}
                title="Add at end"
                onClick={() =>
                  setProject((current) =>
                    addMixPlacement(current, laneId, track.id, end),
                  )
                }
              >
                <Plus size={17} />
              </button>
            </div>
          ))}
          {!library.length && (
            <div className="music-library-empty">
              <Icon size={29} />
              <strong>
                No {lane.kind === "music" ? "music" : "sound effects"} imported
                yet
              </strong>
              <span>
                Close this dialog, add audio, and choose{" "}
                {lane.kind === "music" ? "Music" : "Sound effect"}.
              </span>
            </div>
          )}
        </div>
        <footer>
          <span className="music-save-caption">
            Original files stay untouched.
          </span>
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={() => onSave(project)}>
            Save arrangement
          </button>
        </footer>
      </section>
    </div>
  );
}
