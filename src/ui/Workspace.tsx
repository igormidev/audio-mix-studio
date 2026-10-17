import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  Fragment,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FileAudio2,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Minus,
  Redo2,
  Scissors,
  Search,
  Settings2,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type {
  AudioSegment,
  AudioTrack,
  DependencyStatus,
  JointSettings,
  MixProject,
  OperationProgress,
  SentenceGroup,
  StudioTheme,
} from "../shared/types";
import {
  appendTracks,
  appendSentenceAlternatives,
  chooseVariation,
  masterClips,
  masterDuration,
  moveGroup,
  removeTrack,
  splitSegment,
  toggleSegment,
  trimSegment,
  setGroupSpeed,
  setJointOverride,
  setJointDefaults,
  effectiveJointSettings,
} from "../domain/project";
import { clock, secondsLabel } from "./format";
import { Settings } from "./Settings";
import { usePlayer } from "./usePlayer";
import { Waveform } from "./Waveform";
import { MasterTimeline } from "./MasterTimeline";
import { JointDivider } from "./JointDivider";
import type { EditorAction, EditorState } from "./editor";
import { loadDependencies, rememberDependencies } from "./dependencies";

type AudioDropTarget =
  | { kind: "take"; zone: "empty" | "sidebar" | "master" | "manual" }
  | { kind: "sentence"; groupId: string };

export interface WorkspaceProps {
  editor: EditorState;
  dispatch: (action: EditorAction) => void;
  active: boolean;
  theme: StudioTheme;
  onThemeChange: (theme: StudioTheme) => void;
  onOpenProject: (project: MixProject) => void;
  onBusyChange: (id: string, busy: boolean) => void;
  showQuickGuide: boolean;
  onExported: () => void;
  onRequestDemo: () => void;
  demoRequest: number;
}
export const Workspace = memo(function Workspace({
  editor,
  dispatch,
  active,
  theme,
  onThemeChange,
  onOpenProject,
  onBusyChange,
  showQuickGuide,
  onExported,
  onRequestDemo,
  demoRequest,
}: WorkspaceProps) {
  const { project, past, future } = editor;
  const history = { past, future };
  const [status, setStatus] = useState<DependencyStatus | null>(null);
  const [tab, setTab] = useState<"choices" | "manual">("choices");
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [working, setBusy] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [exportMenu, setExportMenu] = useState(false);
  const [confirmAlign, setConfirmAlign] = useState(false);
  const [dropTarget, setDropTarget] = useState<AudioDropTarget | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cutTool, setCutTool] = useState(false);
  const [zoom, setZoom] = useState(1);
  const busy = working;
  const operation = useRef(false);
  const clips = useMemo(() => masterClips(project), [project]);
  const duration = useMemo(() => masterDuration(project), [project]);
  const player = usePlayer(project, clips, setError);
  const playerStop = player.stop;
  const isPlaying = player.playing;
  const playMaster = player.playMaster;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const projectRef = useRef(project);
  projectRef.current = project;
  const hasUnanalyzed = project.tracks.some(
    (t) => !t.sentenceGroupId && !t.transcript,
  );

  const adopt = useCallback(
    (next: MixProject, reset = false) => {
      playerStop();
      projectRef.current = next;
      dispatch({
        type: "adopt",
        project: next,
        reset,
        now: new Date().toISOString(),
      });
      setSelected(null);
    },
    [playerStop, dispatch],
  );
  const edit = useCallback(
    (update: (p: MixProject) => MixProject) => {
      if (operation.current) return;
      playerStop();
      dispatch({ type: "edit", update, now: new Date().toISOString() });
    },
    [playerStop, dispatch],
  );
  const undo = useCallback(() => {
    if (operation.current) return;
    playerStop();
    dispatch({ type: "undo" });
    setSelected(null);
  }, [playerStop, dispatch]);
  const redo = useCallback(() => {
    if (operation.current) return;
    playerStop();
    dispatch({ type: "redo" });
    setSelected(null);
  }, [playerStop, dispatch]);
  const refresh = useCallback(async (force = false) => {
    try {
      setStatus(await loadDependencies(force));
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    const off = window.studio.onProgress((value) => {
      if (
        value &&
        operation.current &&
        (!value.projectId || value.projectId === project.id)
      )
        setProgress(value);
    });
    void refresh();
    return off;
  }, [refresh, project.id]);
  useEffect(() => {
    if (!active) playerStop();
    else void refresh();
  }, [active, playerStop, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (operation.current) return;
      operation.current = true;
      setBusy(true);
      onBusyChange(project.id, true);
      setError("");
      setNotice("");
      playerStop();
      try {
        await task();
      } catch (e) {
        const text = message(e);
        if (/cancel|abort/i.test(text))
          setNotice("Cancelled. Your edits are kept.");
        else setError(text);
      } finally {
        operation.current = false;
        setBusy(false);
        onBusyChange(project.id, false);
        setProgress(null);
        void refresh();
      }
    },
    [refresh, playerStop, onBusyChange, project.id],
  );
  const analyze = useCallback(() => {
    setConfirmAlign(false);
    void run(async () => {
      const next = await window.studio.analyze(projectRef.current);
      adopt(next);
      setTab("choices");
      setNotice("Sentences grouped.");
    });
  }, [run, adopt]);
  const importAudio = useCallback(
    (paths?: string[]) => {
      void run(async () => {
        const tracks = paths
          ? await window.studio.importPaths(paths, project.id)
          : await window.studio.importAudio(project.id);
        if (!tracks.length) return;
        const hadTracks = projectRef.current.tracks.length > 0;
        const next = appendTracks(projectRef.current, tracks);
        adopt(next);
        if (!hadTracks) {
          const tools = status ?? (await loadDependencies());
          if (!tools.whisperx.available) {
            setStatus(tools);
            setSettings(true);
            setError(
              "Your audio is imported. Prepare WhisperX in Studio settings, then group sentences.",
            );
            return;
          }
          try {
            adopt(await window.studio.analyze(next));
            setNotice("Sentences grouped.");
          } catch (e) {
            setError(
              `${message(e)} Your audio is imported and available in Manual edit.`,
            );
          }
        } else setNotice("Audio imported. Group sentences to compare.");
      });
    },
    [run, adopt, status, project.id],
  );
  const addSentenceAudio = useCallback(
    (groupId: string, paths?: string[]) => {
      void run(async () => {
        // Capture the row before opening a picker. A later active tab cannot
        // redirect this operation, and a missing target is never a full import.
        if (!projectRef.current.groups.some((g) => g.id === groupId))
          throw new Error("That sentence is no longer available.");
        const tracks = paths
          ? await window.studio.importPaths(paths, project.id)
          : await window.studio.importAudio(project.id);
        if (!tracks.length) return;
        adopt(appendSentenceAlternatives(projectRef.current, groupId, tracks));
        setNotice("Audio choice added.");
      });
    },
    [run, adopt, project.id],
  );
  const save = useCallback(
    (saveAs = false) => {
      if (operation.current) return;
      void run(async () => {
        const snapshot = projectRef.current;
        const path = await window.studio.saveProject(snapshot, saveAs);
        if (path) setNotice("Project saved.");
      });
    },
    [run],
  );
  const open = useCallback(() => {
    void run(async () => {
      const next = await window.studio.openProject(project.id);
      if (next) {
        onOpenProject(next);
      }
    });
  }, [run, onOpenProject, project.id]);
  const exportAudio = useCallback(
    (format: "wav" | "mp3") => {
      setExportMenu(false);
      void run(async () => {
        const path = await window.studio.exportAudio(
          projectRef.current,
          format,
        );
        if (path) {
          onExported();
          setNotice(`Exported ${format.toUpperCase()}.`);
        }
      });
    },
    [run, onExported],
  );
  const demo = useCallback(() => {
    void run(async () => {
      const next = await window.studio.demoProject(project.id);
      adopt({ ...next, id: projectRef.current.id }, true);
      setNotice("Sample project opened.");
    });
  }, [run, adopt, project.id]);
  const handledDemo = useRef(0);
  useEffect(() => {
    if (active && demoRequest && handledDemo.current !== demoRequest) {
      handledDemo.current = demoRequest;
      demo();
    }
  }, [active, demoRequest, demo]);
  useEffect(() => {
    const shortcut = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (!active || document.querySelector('[role="dialog"]')) return;
      if (action === "import") importAudio();
      if (action === "undo" || action === "redo") {
        const target = document.activeElement as HTMLElement | null;
        if (
          target &&
          (["INPUT", "TEXTAREA"].includes(target.tagName) ||
            target.isContentEditable)
        )
          document.execCommand(action);
        else if (action === "undo") undo();
        else redo();
      }
      if (action === "save") save();
      if (action === "saveAs") save(true);
      if (action === "open") open();
      if (
        action === "export" &&
        projectRef.current.segments.some((s) => s.enabled)
      )
        exportAudio("wav");
    };
    window.addEventListener("studio-shortcut", shortcut);
    return () => window.removeEventListener("studio-shortcut", shortcut);
  }, [importAudio, save, open, exportAudio, undo, redo, active]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable ||
        settings ||
        help ||
        confirmAlign ||
        !active
      )
        return;
      if (e.code === "Space") {
        if (target.closest('button,[role="button"],[role="tab"]')) return;
        e.preventDefault();
        if (!busyRef.current && clips.length) {
          if (isPlaying) playerStop();
          else playMaster();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Escape") {
        playerStop();
        setCutTool(false);
        setSelected(null);
        setExportMenu(false);
      }
      if (e.key.toLowerCase() === "c" && tab === "manual")
        setCutTool((c) => !c);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [
    clips.length,
    isPlaying,
    playerStop,
    playMaster,
    settings,
    help,
    confirmAlign,
    active,
    undo,
    redo,
    tab,
  ]);

  useEffect(() => {
    if (!active || (!settings && !help && !confirmAlign)) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const selector =
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]';
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetParent !== null,
      );
    focusable()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        setSettings(false);
        setHelp(false);
        setConfirmAlign(false);
        event.preventDefault();
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [settings, help, confirmAlign, active]);

  const choose = useCallback(
    (groupId: string, trackId: string) =>
      edit((p) => chooseVariation(p, groupId, trackId)),
    [edit],
  );
  const skip = useCallback(
    (groupId: string) =>
      edit((p) => ({
        ...p,
        segments: p.segments.map((s) =>
          s.groupId === groupId ? { ...s, enabled: false } : s,
        ),
      })),
    [edit],
  );
  const move = useCallback(
    (groupId: string, direction: -1 | 1) =>
      edit((p) => moveGroup(p, groupId, direction)),
    [edit],
  );
  const toggle = useCallback(
    (id: string) => edit((p) => toggleSegment(p, id)),
    [edit],
  );
  const cut = useCallback(
    (id: string, time: number) => edit((p) => splitSegment(p, id, time)),
    [edit],
  );
  const precedingAudibleGroup = useMemo(() => {
    const audible = new Set(
      project.segments.filter((s) => s.enabled).map((s) => s.groupId),
    );
    const result = new Map<string, SentenceGroup>();
    let previous: SentenceGroup | undefined;
    for (const group of project.groups) {
      if (!audible.has(group.id)) continue;
      if (previous) result.set(group.id, previous);
      previous = group;
    }
    return result;
  }, [project]);
  const changeSpeed = useCallback(
    (groupId: string, speed: number) =>
      edit((p) => setGroupSpeed(p, groupId, speed)),
    [edit],
  );
  const changeJoint = useCallback(
    (left: string, right: string, settings: Partial<JointSettings>) =>
      edit((p) => setJointOverride(p, left, right, settings)),
    [edit],
  );
  useEffect(() => {
    setDropTarget(null);
  }, [active, busy, tab, settings, help, confirmAlign]);
  const findDropTarget = (
    target: EventTarget | null,
  ): AudioDropTarget | null => {
    if (!active || operation.current || settings || help || confirmAlign)
      return null;
    if (!project.tracks.length) return { kind: "take", zone: "empty" };
    if (!(target instanceof Element)) return null;
    const sentence = target.closest<HTMLElement>("[data-sentence-drop]");
    if (sentence?.dataset.sentenceDrop)
      return { kind: "sentence", groupId: sentence.dataset.sentenceDrop };
    const region = target.closest<HTMLElement>("[data-full-take-drop]");
    const zone = region?.dataset.fullTakeDrop;
    if (zone === "sidebar" || zone === "master" || zone === "manual")
      return { kind: "take", zone };
    return null;
  };
  const filteredGroups = project.groups.filter((group) =>
    `${group.text} ${group.note}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedSegment = project.segments.find((s) => s.id === selected);
  return (
    <div
      className="app workspace-page"
      hidden={!active}
      role="tabpanel"
      id={`project-panel-${project.id}`}
      aria-labelledby={`project-tab-${project.id}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        // Prevent Chromium from navigating to a dropped file even in regions
        // that intentionally do not import audio.
        e.preventDefault();
        const target = findDropTarget(e.target);
        e.dataTransfer.dropEffect = target ? "copy" : "none";
        setDropTarget((previous) =>
          JSON.stringify(previous) === JSON.stringify(target)
            ? previous
            : target,
        );
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropTarget(null);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        const target = findDropTarget(e.target);
        setDropTarget(null);
        if (!target) return;
        const paths = Array.from(e.dataTransfer.files)
          .map((file) => window.studio.pathForFile(file))
          .filter(Boolean);
        if (!paths.length) return;
        if (target.kind === "sentence") addSentenceAudio(target.groupId, paths);
        else importAudio(paths);
      }}
    >
      <aside className="sidebar" data-full-take-drop="sidebar">
        {dropTarget?.kind === "take" && dropTarget.zone === "sidebar" && (
          <TakeDropOverlay />
        )}
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={22} />
          </span>
          <span>
            Audio Mix<span className="brand-sub">STUDIO</span>
          </span>
        </div>
        <div className="sidebar-heading">
          <span>YOUR TAKES</span>
          <span className="count">
            {project.tracks.length.toString().padStart(2, "0")}
          </span>
        </div>
        <div className="take-list">
          {project.tracks.length ? (
            project.tracks.map((track, i) => (
              <div
                className="take"
                key={track.id}
                title={track.name}
                style={{ "--take-color": track.color } as React.CSSProperties}
              >
                <strong className="take-filename">{track.name}</strong>
                <button
                  className="take-remove icon-button"
                  disabled={busy}
                  title="Remove take from mix (original file stays safe)"
                  aria-label={`Remove ${track.name}`}
                  onClick={() => edit((p) => removeTrack(p, track.id))}
                >
                  <X size={13} />
                </button>
                <div className="take-detail">
                  <span className="take-symbol">
                    <FileAudio2 size={20} />
                  </span>
                  <div className="take-info">
                    <span className="take-name">Take {i + 1}</span>
                    <span className="take-metadata">
                      {clock(track.duration)}
                      <span className="take-divider">·</span>
                      <strong>
                        {Math.round(
                          (clips
                            .filter((c) => c.trackId === track.id)
                            .reduce((sum, c) => sum + c.duration, 0) /
                            (clips.reduce((sum, c) => sum + c.duration, 0) ||
                              1)) *
                            100,
                        )}
                        % of mix
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-library">
              <Layers3 size={28} strokeWidth={1} />
              <p>No audio yet</p>
            </div>
          )}
        </div>
        <button
          className="add-take"
          disabled={busy}
          onClick={() => importAudio()}
        >
          <Plus size={16} />
          Add audio takes
        </button>
        <div className="export-wrap">
          <button
            className="button primary"
            disabled={busy || !clips.length}
            onClick={() => setExportMenu((v) => !v)}
            aria-expanded={exportMenu}
          >
            <Download size={15} />
            Export master
            <ChevronDown size={13} />
          </button>
          {exportMenu && (
            <>
              <div
                className="menu-dismiss"
                onClick={() => setExportMenu(false)}
              />
              <div className="export-menu">
                <button onClick={() => exportAudio("wav")}>
                  <FileAudio2 size={16} />
                  <div>
                    <strong>WAV audio</strong>
                    <small>Lossless · 48 kHz · 24-bit</small>
                  </div>
                </button>
                <button onClick={() => exportAudio("mp3")}>
                  <FileAudio2 size={16} />
                  <div>
                    <strong>MP3 audio</strong>
                    <small>Compact · 320 kbps</small>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          {showQuickGuide && (
            <button
              className="sidebar-button guide-button"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={16} />
              Quick guide
            </button>
          )}
          <button className="sidebar-button" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            Studio settings
          </button>
        </div>
      </aside>
      <main>
        <section
          className="master-section"
          aria-label="Master audio timeline"
          data-full-take-drop="master"
        >
          {dropTarget?.kind === "take" && dropTarget.zone === "master" && (
            <TakeDropOverlay />
          )}
          <div className="master-heading">
            <div className="master-title">
              <span className="master-icon">
                <AudioLines size={16} />
              </span>
              <h2>Master track</h2>
            </div>
            <span className="master-details">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
              <span>·</span>
              <strong>{clock(duration, true)}</strong>
            </span>
          </div>
          <MasterTimeline
            project={project}
            clips={clips}
            duration={duration}
            position={player.position}
            active={active}
            following={player.playing && !player.previewId}
            onSeek={player.seek}
          />
          <div className="transport">
            <div className="transport-left">
              <button
                className="icon-button"
                aria-label="Return to start"
                disabled={!clips.length || busy}
                onClick={() => player.seek(0)}
              >
                <SkipBack size={16} />
              </button>
              <button
                className="play-master"
                disabled={!clips.length || busy}
                aria-label={
                  player.playing && !player.previewId
                    ? "Pause master"
                    : "Play master"
                }
                onClick={() => {
                  if (player.playing && !player.previewId) player.stop();
                  else player.playMaster();
                }}
              >
                {player.preparing && !player.previewId ? (
                  <LoaderCircle size={16} className="spin" />
                ) : player.playing && !player.previewId ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
              <span className="transport-time">
                {clock(player.position, true)}
                <span>/ {clock(duration, true)}</span>
              </span>
            </div>
            <input
              className="master-scrub"
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={Math.min(player.position, duration)}
              disabled={!clips.length || busy}
              aria-label="Seek master track"
              onChange={(e) => player.seek(Number(e.target.value))}
            />
            <div className="transport-right">
              {player.preparing ? (
                <LoaderCircle size={11} className="spin" />
              ) : (
                <span className="dot green" />
              )}
              {player.preparing ? "Preparing audio…" : "48 kHz stereo"}
              <span className="transport-key">space to play</span>
            </div>
          </div>
        </section>

        <div className="editor-nav">
          <div className="tabs" role="tablist" aria-label="Editing mode">
            <button
              role="tab"
              id={`choices-tab-${project.id}`}
              aria-controls={`choices-panel-${project.id}`}
              aria-selected={tab === "choices"}
              className={tab === "choices" ? "active" : ""}
              onClick={() => setTab("choices")}
            >
              <Layers3 size={16} />
              Sentence choices
              {project.groups.length > 0 && (
                <span>{project.groups.length}</span>
              )}
            </button>
            <button
              role="tab"
              id={`manual-tab-${project.id}`}
              aria-controls={`manual-panel-${project.id}`}
              aria-selected={tab === "manual"}
              className={tab === "manual" ? "active" : ""}
              onClick={() => setTab("manual")}
            >
              <SlidersHorizontal size={16} />
              Manual edit
            </button>
          </div>
          <div className="edit-actions">
            {!!project.tracks.length && (
              <button
                className={`button ${hasUnanalyzed ? "primary" : "secondary"} align-button`}
                disabled={busy}
                onClick={() =>
                  project.segments.length ? setConfirmAlign(true) : analyze()
                }
              >
                <Sparkles size={14} />
                {hasUnanalyzed ? "Group sentences" : "Regroup sentences"}
              </button>
            )}

            <button
              className="icon-button"
              disabled={busy || !history.past.length}
              onClick={undo}
              aria-label="Undo"
              title="Undo · ⌘Z"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              disabled={busy || !history.future.length}
              onClick={redo}
              aria-label="Redo"
              title="Redo · ⌘⇧Z"
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
        {(error || editor.error) && (
          <div className="error-banner" role="alert">
            <span>{error || editor.error}</span>
            <button className="text-button" onClick={() => setSettings(true)}>
              Check setup
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => {
                setError("");
                dispatch({ type: "dismissError" });
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <Check size={14} />
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {busy && (
          <div className="progress-banner" role="status" aria-live="polite">
            <LoaderCircle size={17} className="spin" />
            <div>
              <strong>{progress?.message || "Getting things ready…"}</strong>
              {progress?.fraction !== undefined && (
                <div className="progress-line">
                  <span
                    style={{
                      width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
            <button
              className="text-button"
              onClick={() => void window.studio.cancel(project.id)}
            >
              Cancel
            </button>
          </div>
        )}

        {!project.tracks.length ? (
          <div className="welcome">
            <AudioLines size={38} strokeWidth={1.5} />
            <h1>Compare your takes</h1>
            <p>
              Import audio to choose your favorite version of each sentence.
            </p>
            <button
              className="button primary large"
              disabled={busy}
              onClick={() => importAudio()}
            >
              <Upload size={17} />
              Import your audio
            </button>
            <span className="file-formats">or drop audio files here</span>
          </div>
        ) : (
          <section
            className="editor-content"
            id={
              tab === "choices"
                ? `choices-panel-${project.id}`
                : `manual-panel-${project.id}`
            }
            role="tabpanel"
            aria-labelledby={
              tab === "choices"
                ? `choices-tab-${project.id}`
                : `manual-tab-${project.id}`
            }
          >
            {tab === "choices" ? (
              <>
                <div className="list-toolbar">
                  <label className="search">
                    <Search size={14} />
                    <input
                      aria-label="Find a sentence"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a sentence…"
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </label>
                </div>
                <div className="sentence-list">
                  {filteredGroups.map((group) => {
                    const index = project.groups.indexOf(group);
                    const previous = precedingAudibleGroup.get(group.id);
                    return (
                      <Fragment key={group.id}>
                        {previous && !query && (
                          <JointDivider
                            value={effectiveJointSettings(
                              project,
                              previous.id,
                              group.id,
                            )}
                            disabled={busy}
                            before={project.groups.indexOf(previous) + 1}
                            after={index + 1}
                            onChange={(update) =>
                              changeJoint(previous.id, group.id, update)
                            }
                          />
                        )}
                        {index > 0 && !previous && !query && (
                          <div className="sentence-separator" />
                        )}
                        <SentenceRow
                          group={group}
                          index={index}
                          project={project}
                          disabled={busy}
                          previewId={player.previewId}
                          onPreview={player.previewMany}
                          onChoose={choose}
                          onSkip={skip}
                          onMove={move}
                          onSpeed={changeSpeed}
                          onAddAudio={addSentenceAudio}
                          dropActive={
                            dropTarget?.kind === "sentence" &&
                            dropTarget.groupId === group.id
                          }
                        />
                      </Fragment>
                    );
                  })}
                </div>
                {!filteredGroups.length && (
                  <div className="no-results">
                    {query
                      ? "No sentences match your search."
                      : "Your takes are ready. Group sentences to compare variations, or start with Manual edit."}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="manual-toolbar">
                  <div className="tool-switch">
                    <button
                      className={!cutTool ? "active" : ""}
                      onClick={() => setCutTool(false)}
                      title="Click segments to include or mute"
                    >
                      <Volume2 size={14} />
                      Select
                    </button>
                    <button
                      className={cutTool ? "active" : ""}
                      onClick={() => setCutTool(true)}
                      title="Cut a segment at the click position · C"
                    >
                      <Scissors size={14} />
                      Cut<span className="key">C</span>
                    </button>
                  </div>
                  <label className="zoom">
                    Zoom
                    <input
                      aria-label="Timeline zoom"
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                    <span>{zoom.toFixed(1)}×</span>
                  </label>
                  <span className="manual-legend">
                    <span className="dot green" />
                    In master
                    <span className="dot gray" />
                    Muted
                  </span>
                </div>
                <div
                  className="manual-drop-region"
                  data-full-take-drop="manual"
                >
                  {dropTarget?.kind === "take" &&
                    dropTarget.zone === "manual" && <TakeDropOverlay />}
                  <div className="tracks-scroll">
                    <div
                      className="manual-tracks"
                      style={{ minWidth: `${zoom * 100}%` }}
                    >
                      {project.tracks.map((track) => (
                        <ManualTrack
                          key={track.id}
                          track={track}
                          project={project}
                          cutTool={cutTool}
                          selected={selected}
                          previewId={player.previewId}
                          disabled={busy}
                          onPreview={player.preview}
                          onSelect={setSelected}
                          onToggle={toggle}
                          onCut={cut}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {selectedSegment && (
                  <SegmentInspector
                    key={`${selectedSegment.id}:${selectedSegment.start}:${selectedSegment.end}`}
                    segment={selectedSegment}
                    track={project.tracks.find(
                      (t) => t.id === selectedSegment.trackId,
                    )!}
                    disabled={busy}
                    onPreview={() => player.preview(selectedSegment)}
                    onTrim={(start, end) =>
                      edit((p) =>
                        trimSegment(p, selectedSegment.id, start, end),
                      )
                    }
                    onClose={() => setSelected(null)}
                  />
                )}
              </>
            )}
          </section>
        )}
      </main>
      {active && dropTarget?.kind === "take" && dropTarget.zone === "empty" && (
        <div className="drop-overlay">
          <div>
            <Upload size={36} />
            <h2>Drop audio to import</h2>
          </div>
        </div>
      )}
      {active && settings && (
        <Settings
          project={project}
          theme={theme}
          onThemeChange={onThemeChange}
          status={status}
          busy={busy}
          onCancel={() => void window.studio.cancel(project.id)}
          onClose={() => setSettings(false)}
          onChangeModel={(model) => edit((p) => ({ ...p, model }))}
          onJointDefaults={(update) => edit((p) => setJointDefaults(p, update))}
          onCodexChange={(codex) => edit((p) => ({ ...p, codex }))}
          onGuide={() => {
            setSettings(false);
            setHelp(true);
          }}
          onRefresh={() => void refresh(true)}
          onSetup={() =>
            void run(async () => {
              setStatus(
                rememberDependencies(
                  await window.studio.setupTranscription(
                    projectRef.current.model,
                    project.id,
                  ),
                ),
              );
              setNotice("Model ready.");
            })
          }
          onExportJSON={() =>
            void run(async () => {
              const path = await window.studio.exportAlignment(
                projectRef.current,
              );
              if (path) setNotice("Alignment JSON exported.");
            })
          }
        />
      )}
      {active && confirmAlign && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="regroup-title"
          >
            <span className="modal-symbol">
              <Sparkles size={23} />
            </span>
            <h2 id="regroup-title">Regroup your sentences?</h2>
            <p>
              This replaces sentence groups and manual cuts. You can undo it.
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                className="button secondary"
                onClick={() => setConfirmAlign(false)}
              >
                Keep editing
              </button>
              <button className="button primary" onClick={analyze}>
                <Sparkles size={14} />
                Regroup sentences
              </button>
            </div>
          </section>
        </div>
      )}
      {active && help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 id="help-title">Your best narration, in three steps.</h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close guide"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
            </header>
            <ol>
              <li>
                <strong>Bring all your takes.</strong>
                <p>
                  Import audio downloaded from ElevenLabs or any voice tool.
                  Your first import transcribes and groups automatically.
                </p>
              </li>
              <li>
                <strong>Pick the voice you like.</strong>
                <p>
                  Preview each sentence with the play button. Click a card to
                  use that version in the master. A sentence unique to one take
                  has its own group.
                </p>
              </li>
              <li>
                <strong>Polish and export.</strong>
                <p>
                  Use Manual edit to split, trim, or mute sections. Save your
                  project with ⌘S. Export a WAV or MP3 when it sounds right.
                </p>
              </li>
            </ol>
            <div className="help-keys">
              <span>
                <kbd>space</kbd>Play master
              </span>
              <span>
                <kbd>⌘ Z</kbd>Undo
              </span>
              <span>
                <kbd>C</kbd>Cut tool
              </span>
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                setHelp(false);
                onRequestDemo();
              }}
            >
              Let’s make a mix
            </button>
          </section>
        </div>
      )}
    </div>
  );
});

function TakeDropOverlay() {
  return (
    <div className="take-drop-overlay" aria-hidden="true">
      <Upload size={22} />
      <span>Drop to add audio takes</span>
    </div>
  );
}

const SentenceRow = memo(function SentenceRow({
  group,
  index,
  project,
  disabled,
  previewId,
  onPreview,
  onChoose,
  onSkip,
  onMove,
  onSpeed,
  onAddAudio,
  dropActive,
}: {
  group: SentenceGroup;
  index: number;
  project: MixProject;
  disabled: boolean;
  previewId: string | null;
  onPreview: (segments: AudioSegment[]) => void;
  onChoose: (groupId: string, trackId: string) => void;
  onSkip: (groupId: string) => void;
  onMove: (groupId: string, direction: -1 | 1) => void;
  onSpeed: (groupId: string, speed: number) => void;
  onAddAudio: (groupId: string, paths?: string[]) => void;
  dropActive: boolean;
}) {
  const segments = project.segments.filter((s) => s.groupId === group.id);
  const variations = project.tracks.flatMap((track) => {
    const parts = segments
      .filter((s) => s.trackId === track.id)
      .sort((a, b) => a.start - b.start);
    return parts.length ? [{ track, parts }] : [];
  });
  const activeTracks = variations.filter((v) => v.parts.some((s) => s.enabled));
  const skipped = activeTracks.length === 0;
  const eligibleTakes = project.tracks.filter(
    (track) => !track.sentenceGroupId || track.sentenceGroupId === group.id,
  ).length;
  return (
    <article
      className={`sentence-row ${skipped ? "skipped" : ""} ${dropActive ? "drop-active" : ""}`}
      data-sentence-drop={group.id}
    >
      {dropActive && (
        <div className="sentence-drop-overlay" aria-hidden="true">
          <Plus size={19} />
          <span>Drop to add a choice to sentence {index + 1}</span>
        </div>
      )}
      <div className="sentence-number">
        {String(index + 1).padStart(2, "0")}
        <div className="reorder">
          <button
            aria-label={`Move sentence ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(group.id, -1)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            aria-label={`Move sentence ${index + 1} down`}
            disabled={disabled || index === project.groups.length - 1}
            onClick={() => onMove(group.id, 1)}
          >
            <ArrowDown size={12} />
          </button>
        </div>
      </div>
      <div className="sentence-body">
        <div className="sentence-heading">
          <h3 title={group.note || undefined}>{group.text}</h3>
          <div className="sentence-tags">
            {variations.length < eligibleTakes && (
              <span className="unique-badge">
                {variations.length === 1
                  ? "Unique sentence"
                  : `${variations.length} of ${eligibleTakes} takes`}
              </span>
            )}
            {activeTracks.length > 1 && (
              <span className="custom-badge">Custom mix</span>
            )}
            {skipped && <span className="unique-badge">Skipped</span>}
            <button
              className="text-button sentence-add-audio"
              disabled={disabled}
              aria-label={`Add audio to sentence ${index + 1}`}
              title="Add an audio choice to this sentence"
              onClick={() => onAddAudio(group.id)}
            >
              <Plus size={13} />
              Add audio
            </button>
            <div
              className="sentence-speed"
              role="group"
              aria-label={`Sentence ${index + 1} speed`}
            >
              <button
                className="icon-button"
                aria-label={`Decrease sentence ${index + 1} speed`}
                disabled={disabled || (group.speed ?? 1) <= 0.5}
                onClick={() => onSpeed(group.id, (group.speed ?? 1) - 0.25)}
              >
                <Minus size={12} />
              </button>
              <span aria-live="polite">{group.speed ?? 1}x</span>
              <button
                className="icon-button"
                aria-label={`Increase sentence ${index + 1} speed`}
                disabled={disabled || (group.speed ?? 1) >= 2.5}
                onClick={() => onSpeed(group.id, (group.speed ?? 1) + 0.25)}
              >
                <Plus size={12} />
              </button>
            </div>
            <button
              className="icon-button skip-button"
              disabled={disabled || skipped}
              onClick={() => onSkip(group.id)}
              aria-label={`Skip sentence ${index + 1}`}
              title="Skip this sentence"
            >
              <VolumeX size={14} />
            </button>
          </div>
        </div>
        <div
          className="variations"
          style={{
            gridTemplateColumns: `repeat(${Math.min(3, variations.length)}, minmax(0, 1fr))`,
          }}
        >
          {variations.map(({ track, parts }) => {
            const chosen =
              parts.every((s) => s.enabled) && activeTracks.length === 1;
            const partial = parts.some((s) => s.enabled) && !chosen;
            const start = parts[0].start;
            const end = parts[parts.length - 1].end;
            const isPlaying = previewId === parts[0].id;
            return (
              <div
                className={`variation ${chosen ? "chosen" : ""} ${partial ? "partial" : ""}`}
                key={track.id}
                style={{ "--take-color": track.color } as React.CSSProperties}
              >
                <button
                  className="variation-select"
                  disabled={disabled}
                  aria-label={`Use ${track.name} for sentence ${index + 1}`}
                  aria-pressed={chosen}
                  title={parts.map((part) => part.text).join(" ")}
                  onClick={() => onChoose(group.id, track.id)}
                />
                <div className="variation-wave">
                  <button
                    className={`preview-button ${isPlaying ? "playing" : ""}`}
                    disabled={disabled}
                    aria-label={`${isPlaying ? "Stop" : "Preview"} ${track.name}, sentence ${index + 1}`}
                    onClick={() => onPreview(parts)}
                  >
                    {isPlaying ? (
                      <Pause size={12} fill="currentColor" />
                    ) : (
                      <Play size={12} fill="currentColor" />
                    )}
                  </button>
                  <Waveform
                    peaks={track.peaks}
                    start={start / track.duration}
                    end={end / track.duration}
                    bars={65}
                  />
                  <span className="variation-time">
                    {secondsLabel(
                      parts.reduce(
                        (total, part) => total + part.end - part.start,
                        0,
                      ) / (group.speed ?? 1),
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
});

const ManualTrack = memo(function ManualTrack({
  track,
  project,
  cutTool,
  selected,
  previewId,
  disabled,
  onPreview,
  onSelect,
  onToggle,
  onCut,
}: {
  track: AudioTrack;
  project: MixProject;
  cutTool: boolean;
  selected: string | null;
  previewId: string | null;
  disabled: boolean;
  onPreview: (s: AudioSegment) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onCut: (id: string, time: number) => void;
}) {
  const segments = project.segments.filter((s) => s.trackId === track.id);
  return (
    <div className="manual-track">
      <div className="manual-track-heading">
        <span className="track-indicator" style={{ background: track.color }} />
        <strong>{track.name}</strong>
        <span>{clock(track.duration, true)}</span>
        <button
          className="icon-button"
          disabled={disabled}
          aria-label={`Preview full ${track.name}`}
          onClick={() =>
            onPreview({
              id: track.id,
              trackId: track.id,
              groupId: "",
              start: 0,
              end: track.duration,
              text: track.name,
              enabled: false,
            })
          }
        >
          {previewId === track.id ? <Pause size={14} /> : <Play size={14} />}
        </button>
      </div>
      <div className="manual-ruler">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i}>{clock((track.duration * i) / 8)}</span>
        ))}
      </div>
      <div className={`source-lane ${cutTool ? "cut-cursor" : ""}`}>
        <Waveform peaks={track.peaks} color="#ced3d0" bars={220} />
        {segments.map((segment) => (
          <button
            className={`source-segment ${segment.enabled ? "enabled" : "muted"} ${selected === segment.id ? "inspected" : ""}`}
            style={
              {
                left: `${(segment.start / track.duration) * 100}%`,
                width: `${((segment.end - segment.start) / track.duration) * 100}%`,
                "--take-color": track.color,
              } as React.CSSProperties
            }
            key={segment.id}
            disabled={disabled}
            aria-label={`${segment.enabled ? "Mute" : "Include"} ${segment.text || "segment"} at ${clock(segment.start)}`}
            aria-pressed={segment.enabled}
            onClick={(e) => {
              if (cutTool) {
                const fraction =
                  (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                  e.currentTarget.clientWidth;
                onCut(
                  segment.id,
                  segment.start + fraction * (segment.end - segment.start),
                );
              } else {
                onToggle(segment.id);
                onSelect(segment.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(segment.id);
            }}
            title={
              cutTool
                ? "Click to split here"
                : `${segment.enabled ? "In master · click to mute" : "Muted · click to include"} · Right-click for trim controls`
            }
          >
            <span className="source-segment-text">
              {segment.enabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
              <span>{segment.text || "Audio segment"}</span>
            </span>
            <Waveform
              peaks={track.peaks}
              start={segment.start / track.duration}
              end={segment.end / track.duration}
              bars={Math.max(
                8,
                Math.round(
                  ((segment.end - segment.start) / track.duration) * 210,
                ),
              )}
            />
            <span className="segment-start">{clock(segment.start, true)}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

function SegmentInspector({
  segment,
  track,
  disabled,
  onPreview,
  onTrim,
  onClose,
}: {
  segment: AudioSegment;
  track: AudioTrack;
  disabled: boolean;
  onPreview: () => void;
  onTrim: (start: number, end: number) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(segment.start.toFixed(3));
  const [end, setEnd] = useState(segment.end.toFixed(3));
  // Display milliseconds without rounding an untouched boundary into its neighbour.
  const startValue =
    start === segment.start.toFixed(3) ? segment.start : Number(start);
  const endValue = end === segment.end.toFixed(3) ? segment.end : Number(end);
  const valid =
    Number.isFinite(startValue) &&
    Number.isFinite(endValue) &&
    startValue >= 0 &&
    endValue > startValue &&
    endValue <= track.duration;
  return (
    <div className="segment-inspector">
      <div>
        <span className="eyebrow">SELECTED SEGMENT</span>
        <strong>{track.name}</strong>
      </div>
      <label>
        Start{" "}
        <input
          type="number"
          aria-label="Segment start seconds"
          min="0"
          max={track.duration}
          step="0.01"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <span>s</span>
      </label>
      <label>
        End{" "}
        <input
          type="number"
          aria-label="Segment end seconds"
          min="0"
          max={track.duration}
          step="0.01"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <span>s</span>
      </label>
      <button
        className="icon-button"
        aria-label="Preview selected segment"
        disabled={disabled}
        onClick={onPreview}
      >
        <Play size={15} />
      </button>
      <button
        className="button secondary"
        disabled={disabled || !valid}
        onClick={() => onTrim(startValue, endValue)}
      >
        Apply trim
      </button>
      <button
        className="icon-button"
        aria-label="Close segment controls"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
function message(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : String(error);
}
