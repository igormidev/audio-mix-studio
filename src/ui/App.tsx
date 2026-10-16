import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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
  FolderOpen,
  Headphones,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
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
  MixProject,
  OperationProgress,
  SentenceGroup,
} from "../shared/types";
import {
  appendTracks,
  chooseVariation,
  masterClips,
  masterDuration,
  moveGroup,
  newProject,
  removeTrack,
  splitSegment,
  toggleSegment,
  trimSegment,
} from "../domain/project";
import { clock, secondsLabel } from "./format";
import { Settings } from "./Settings";
import { usePlayer } from "./usePlayer";
import { Waveform } from "./Waveform";
import { editorReducer, initialEditor } from "./editor";

export function App() {
  const [editor, dispatch] = useReducer(editorReducer, undefined, () =>
    initialEditor(newProject()),
  );
  const { project, past, future } = editor;
  const history = { past, future };
  const [nameDraft, setNameDraft] = useState<string | null>(null);
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
  const [confirmNew, setConfirmNew] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [cutTool, setCutTool] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const busy = working || !ready;
  const [autosaveState, setAutosaveState] = useState<
    "saving" | "saved" | "error"
  >("saved");
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
  const sourceDuration = project.tracks.reduce(
    (total, track) => total + track.duration,
    0,
  );
  const hasUnanalyzed = project.tracks.some((t) => !t.transcript);

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
      setNameDraft(null);
      setSelected(null);
    },
    [playerStop],
  );
  const edit = useCallback(
    (update: (p: MixProject) => MixProject) => {
      if (operation.current) return;
      playerStop();
      dispatch({ type: "edit", update, now: new Date().toISOString() });
    },
    [playerStop],
  );
  const undo = useCallback(() => {
    if (operation.current) return;
    playerStop();
    dispatch({ type: "undo" });
    setSelected(null);
  }, [playerStop]);
  const redo = useCallback(() => {
    if (operation.current) return;
    playerStop();
    dispatch({ type: "redo" });
    setSelected(null);
  }, [playerStop]);
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.studio.dependencies());
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    let active = true;
    const off = window.studio.onProgress(setProgress);
    void refresh();
    void window.studio
      .restoreProject()
      .then((p) => {
        if (active) {
          if (p) dispatch({ type: "adopt", project: p, reset: true });
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(message(e));
          setReady(true);
        }
      });
    return () => {
      active = false;
      off();
    };
  }, [refresh]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setAutosaveState("saving");
    void window.studio
      .autosave(project)
      .then(() => {
        if (active) setAutosaveState("saved");
      })
      .catch((e) => {
        if (active) {
          setAutosaveState("error");
          setError(`Could not autosave: ${message(e)}`);
        }
      });
    return () => {
      active = false;
    };
  }, [project, ready]);
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
      setError("");
      setNotice("");
      playerStop();
      try {
        await task();
      } catch (e) {
        const text = message(e);
        if (/cancel|abort/i.test(text))
          setNotice(
            "Operation cancelled. Your imported audio and current edits are kept.",
          );
        else setError(text);
      } finally {
        operation.current = false;
        setBusy(false);
        setProgress(null);
        void refresh();
      }
    },
    [refresh, playerStop],
  );
  const analyze = useCallback(() => {
    setConfirmAlign(false);
    void run(async () => {
      const next = await window.studio.analyze(projectRef.current);
      adopt(next);
      setTab("choices");
      setNotice(
        "Sentences are ready. Listen to the variations and choose your favorites.",
      );
    });
  }, [run, adopt]);
  const importAudio = useCallback(
    (paths?: string[]) => {
      void run(async () => {
        const tracks = paths
          ? await window.studio.importPaths(paths)
          : await window.studio.importAudio();
        if (!tracks.length) return;
        const hadTracks = projectRef.current.tracks.length > 0;
        const next = appendTracks(projectRef.current, tracks);
        adopt(next);
        if (!hadTracks) {
          const tools = status ?? (await window.studio.dependencies());
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
            setNotice("Sentences grouped. Your first mix is ready to refine.");
          } catch (e) {
            setError(
              `${message(e)} Your audio is imported and available in Manual edit.`,
            );
          }
        } else
          setNotice(
            "Takes added. Group sentences when you’re ready; regrouping replaces existing cuts.",
          );
      });
    },
    [run, adopt, status],
  );
  const save = useCallback(
    (saveAs = false) => {
      if (operation.current) return;
      setSaving(true);
      void run(async () => {
        const snapshot =
          nameDraft === null
            ? projectRef.current
            : {
                ...projectRef.current,
                name: nameDraft.trim() || "Untitled mix",
              };
        if (nameDraft !== null) adopt(snapshot);
        const path = await window.studio.saveProject(snapshot, saveAs);
        if (path)
          setNotice(
            "Project and audio saved. You can reopen this mix on another Mac.",
          );
      }).finally(() => setSaving(false));
    },
    [run, nameDraft, adopt],
  );
  const open = useCallback(() => {
    void run(async () => {
      const next = await window.studio.openProject();
      if (next) {
        adopt(next, true);
        setNotice("Project opened.");
      }
    });
  }, [run, adopt]);
  const exportAudio = useCallback(
    (format: "wav" | "mp3") => {
      setExportMenu(false);
      void run(async () => {
        const path = await window.studio.exportAudio(
          projectRef.current,
          format,
        );
        if (path)
          setNotice(
            `Master exported as ${format.toUpperCase()}. Ready for your video.`,
          );
      });
    },
    [run],
  );
  const demo = useCallback(() => {
    void run(async () => {
      adopt(await window.studio.demoProject(), true);
      setNotice(
        "A real, playable sample project. Try switching a sentence or making a cut.",
      );
    });
  }, [run, adopt]);
  useEffect(() => {
    const shortcut = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (!ready || document.querySelector('[role="dialog"]')) return;
      if (action === "import") importAudio();
      if (action === "new" && !operation.current) {
        if (projectRef.current.tracks.length) setConfirmNew(true);
        else adopt(newProject(), true);
      }
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
  }, [importAudio, save, open, exportAudio, adopt, undo, redo, ready]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable ||
        settings ||
        help ||
        confirmAlign ||
        confirmNew
      )
        return;
      if (e.code === "Space") {
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
    confirmNew,
    undo,
    redo,
    tab,
  ]);

  useEffect(() => {
    if (!settings && !help && !confirmAlign && !confirmNew) return;
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
        setConfirmNew(false);
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
  }, [settings, help, confirmAlign, confirmNew]);

  const filteredGroups = project.groups.filter((group) =>
    `${group.text} ${group.note}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedSegment = project.segments.find((s) => s.id === selected);
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (busy) return;
        const paths = Array.from(e.dataTransfer.files)
          .map((file) => window.studio.pathForFile(file))
          .filter(Boolean);
        if (paths.length) importAudio(paths);
      }}
    >
      <div className="titlebar">
        <span>Audio Mix Studio</span>
        <span className="titlebar-local">
          <span className="dot green" />
          ON YOUR MAC
        </span>
      </div>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={22} />
          </span>
          <span>
            Audio Mix<span className="brand-sub">STUDIO</span>
          </span>
          <span className="version">BETA</span>
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
              <div className="take" key={track.id}>
                <span
                  className="take-symbol"
                  style={{
                    color: track.color,
                    backgroundColor: `${track.color}14`,
                  }}
                >
                  <FileAudio2 size={19} />
                </span>
                <div className="take-info">
                  <strong title={track.name}>{track.name}</strong>
                  <span>
                    {clock(track.duration)}
                    <span className="take-divider">·</span>Take {i + 1}
                  </span>
                </div>
                <button
                  className="take-remove icon-button"
                  disabled={busy}
                  title="Remove take from mix (original file stays safe)"
                  aria-label={`Remove ${track.name}`}
                  onClick={() => edit((p) => removeTrack(p, track.id))}
                >
                  <X size={13} />
                </button>
                <div className="take-status">
                  {track.transcript ? (
                    <Check size={10} />
                  ) : (
                    <span className="dot amber" />
                  )}
                  {track.transcript ? "Transcribed" : "Ready to transcribe"}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-library">
              <Layers3 size={28} strokeWidth={1} />
              <p>
                Your audio takes
                <br />
                will live here.
              </p>
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
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <Headphones size={18} />
            </span>
            <div>
              <strong>A little less editing.</strong>
              <span>A lot more creating.</span>
            </div>
          </div>
          <button className="sidebar-button" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
            Studio settings
            <span
              className={`dot ${status?.codex.available && status.whisperx.available && status.ffmpeg.available ? "green" : "amber"}`}
            />
          </button>
          <button className="sidebar-button" onClick={() => setHelp(true)}>
            <CircleHelp size={16} />
            Quick guide<span className="key">?</span>
          </button>
          <div className="sidebar-foot">
            Made for the voice behind the video.
          </div>
        </div>
      </aside>
      <main>
        <header className="workspace-header">
          <div>
            <div className="eyebrow">
              WORKSPACE <span>/</span> NARRATION MIX
            </div>
            <input
              className="project-name"
              aria-label="Project name"
              maxLength={120}
              value={nameDraft ?? project.name}
              disabled={busy}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (nameDraft !== null) {
                  const name = nameDraft.trim() || "Untitled mix";
                  edit((p) => ({ ...p, name }));
                  setNameDraft(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              title="Open project · ⌘O"
              aria-label="Open project"
              disabled={busy}
              onClick={open}
            >
              <FolderOpen size={18} />
            </button>
            <button
              className="icon-button"
              title="Save project · ⌘S"
              aria-label="Save project"
              disabled={busy || !project.tracks.length}
              onClick={() => save()}
            >
              {saving ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Save size={18} />
              )}
            </button>
            <span className="header-divider" />
            <button
              className="button secondary import-button"
              disabled={busy}
              onClick={() => importAudio()}
            >
              <Plus size={16} />
              Import audio
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
                    <span>DOWNLOAD YOUR MIX</span>
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
          </div>
        </header>

        <section className="master-section" aria-label="Master audio timeline">
          <div className="master-heading">
            <div className="master-title">
              <span className="master-icon">
                <AudioLines size={16} />
              </span>
              <h2>Master track</h2>
              <span className="pill">YOUR FINAL MIX</span>
            </div>
            <span className="master-details">
              {clips.length} {clips.length === 1 ? "clip" : "clips"}
              <span>·</span>
              <strong>{clock(duration, true)}</strong>
            </span>
          </div>
          <div className="master-timeline">
            <div className="ruler">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>{clock((duration * i) / 6)}</span>
              ))}
            </div>
            <div
              className="master-clips"
              onClick={(e) => {
                if (duration)
                  player.seek(
                    ((e.clientX -
                      e.currentTarget.getBoundingClientRect().left) /
                      e.currentTarget.clientWidth) *
                      duration,
                  );
              }}
            >
              {clips.length ? (
                clips.map((clip, i) => {
                  const track = project.tracks.find(
                    (t) => t.id === clip.trackId,
                  )!;
                  const group = project.groups.find(
                    (g) => g.id === clip.groupId,
                  );
                  return (
                    <div
                      className="master-clip"
                      key={clip.id}
                      style={{
                        width: `${(clip.duration / duration) * 100}%`,
                        color: track.color,
                        background: `${track.color}16`,
                      }}
                      title={`${group?.text ?? clip.text} · ${track.name}`}
                    >
                      <span className="master-clip-label">
                        {String(i + 1).padStart(2, "0")}
                        <span>{clip.text}</span>
                      </span>
                      <Waveform
                        peaks={track.peaks}
                        start={clip.start / track.duration}
                        end={clip.end / track.duration}
                        bars={Math.max(
                          10,
                          Math.round((clip.duration / duration) * 220),
                        )}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="master-empty">
                  <AudioLines size={26} strokeWidth={1} />
                  <span>Your favorite moments, one seamless voice.</span>
                </div>
              )}
              {!!clips.length && (
                <div
                  className="playhead"
                  style={{
                    left: `${Math.min(100, (player.position / duration) * 100)}%`,
                  }}
                >
                  <span />
                </div>
              )}
            </div>
          </div>
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
              id="choices-tab"
              aria-controls="choices-panel"
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
              id="manual-tab"
              aria-controls="manual-panel"
              aria-selected={tab === "manual"}
              className={tab === "manual" ? "active" : ""}
              onClick={() => setTab("manual")}
            >
              <SlidersHorizontal size={16} />
              Manual edit
            </button>
          </div>
          <div className="edit-actions">
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
              onClick={() => void window.studio.cancel()}
            >
              Cancel
            </button>
          </div>
        )}

        {!project.tracks.length ? (
          <div className="welcome">
            <div className="welcome-art">
              <span className="art-track one">
                <AudioLines size={44} />
              </span>
              <span className="art-track two">
                <AudioLines size={44} />
              </span>
              <span className="art-check">
                <Check size={18} />
              </span>
            </div>
            <span className="eyebrow">GREAT NARRATION IS IN THE DETAILS</span>
            <h1>
              Every sentence.
              <br />
              Your favorite take.
            </h1>
            <p>
              Bring your voice tracks. Compare the variations.
              <br />
              Make one narration that sounds just right.
            </p>
            <button
              className="button primary large"
              disabled={busy}
              onClick={() => importAudio()}
            >
              <Upload size={17} />
              Import your audio
            </button>
            <span className="file-formats">
              Drop files anywhere · WAV, MP3, M4A, FLAC & more
            </span>
            <button
              className="text-button demo-button"
              disabled={busy}
              onClick={demo}
            >
              <Play size={13} />
              Explore a sample project<span>↗</span>
            </button>
            <div className="welcome-steps">
              <span>
                <span>01</span>Import your takes
              </span>
              <span>
                <span>02</span>Pick each sentence
              </span>
              <span>
                <span>03</span>Export your master
              </span>
            </div>
          </div>
        ) : (
          <section
            className="editor-content"
            id={tab === "choices" ? "choices-panel" : "manual-panel"}
            role="tabpanel"
            aria-labelledby={tab === "choices" ? "choices-tab" : "manual-tab"}
          >
            <div className="content-toolbar">
              <div>
                <h2>
                  {tab === "choices"
                    ? "A better take, sentence by sentence."
                    : "Make the small things sound right."}
                </h2>
                <p>
                  {tab === "choices"
                    ? "Listen, compare, and choose. Your master updates with every pick."
                    : "Click a segment to include or mute it. Use the scissors to add a cut."}
                </p>
              </div>
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
            </div>
            {tab === "choices" ? (
              <>
                <div className="list-toolbar">
                  <span>
                    {project.groups.length} SENTENCE
                    {project.groups.length === 1 ? "" : "S"}
                    <span className="list-dot">·</span>
                    {project.tracks.length} TAKES
                  </span>
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
                  {filteredGroups.map((group) => (
                    <SentenceRow
                      key={group.id}
                      group={group}
                      index={project.groups.indexOf(group)}
                      project={project}
                      disabled={busy}
                      previewId={player.previewId}
                      onPreview={player.previewMany}
                      onChoose={(trackId) =>
                        edit((p) => chooseVariation(p, group.id, trackId))
                      }
                      onSkip={() =>
                        edit((p) => ({
                          ...p,
                          segments: p.segments.map((s) =>
                            s.groupId === group.id
                              ? { ...s, enabled: false }
                              : s,
                          ),
                        }))
                      }
                      onMove={(direction) =>
                        edit((p) => moveGroup(p, group.id, direction))
                      }
                    />
                  ))}
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
                        onToggle={(id) => edit((p) => toggleSegment(p, id))}
                        onCut={(id, time) =>
                          edit((p) => splitSegment(p, id, time))
                        }
                      />
                    ))}
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
                <p className="manual-note">
                  Segments play in sentence order. If you enable more than one
                  take of a sentence, both play in the master. Drag the zoom
                  slider for precise cuts.
                </p>
              </>
            )}
          </section>
        )}
        <footer className="workspace-footer">
          <span>
            <span className="dot green" />
            {!ready
              ? "Opening your studio…"
              : autosaveState === "saving"
                ? "Saving on this Mac…"
                : autosaveState === "error"
                  ? "Autosave needs attention"
                  : "Autosaved on this Mac"}
          </span>
          <span>
            {project.tracks.length
              ? `${project.tracks.length} source tracks · ${clock(sourceDuration)} original audio`
              : "Your original audio always stays untouched."}
          </span>
          <span>
            WHISPERX + CODEX
            <span className="footer-mark">
              <AudioLines size={14} />
            </span>
          </span>
        </footer>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={36} />
            <h2>Bring in your next take.</h2>
            <p>Drop audio files to add them to this mix.</p>
          </div>
        </div>
      )}
      {settings && (
        <Settings
          project={project}
          status={status}
          busy={busy}
          onClose={() => setSettings(false)}
          onChangeModel={(model) => edit((p) => ({ ...p, model }))}
          onFade={(joinFadeMs) => edit((p) => ({ ...p, joinFadeMs }))}
          onRefresh={() => void refresh()}
          onSetup={() =>
            void run(async () => {
              setStatus(
                await window.studio.setupTranscription(
                  projectRef.current.model,
                ),
              );
              setNotice("WhisperX and the selected model are ready.");
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
      {confirmNew && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
          >
            <h2 id="new-title">Start a new mix?</h2>
            <p>
              Save a portable copy to keep this mix before starting another.
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                className="text-button"
                onClick={() => setConfirmNew(false)}
              >
                Cancel
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  adopt(newProject(), true);
                  setConfirmNew(false);
                }}
              >
                Start new
              </button>
              <button
                className="button primary"
                onClick={() => {
                  void run(async () => {
                    const path = await window.studio.saveProject(
                      projectRef.current,
                    );
                    if (path) {
                      adopt(newProject(), true);
                      setConfirmNew(false);
                    }
                  });
                }}
              >
                Save & start new
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmAlign && (
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
              WhisperX transcribes new takes and Codex compares all transcripts.
              This replaces the current sentence groups and manual cuts. You can
              undo it afterward.
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
      {help && (
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
                  Preview each sentence with the play button. Click “Use take”
                  to add that version to the master. A sentence unique to one
                  take has its own group.
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
            <button className="button primary" onClick={() => setHelp(false)}>
              Let’s make a mix
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function SentenceRow({
  group,
  index,
  project,
  disabled,
  previewId,
  onPreview,
  onChoose,
  onSkip,
  onMove,
}: {
  group: SentenceGroup;
  index: number;
  project: MixProject;
  disabled: boolean;
  previewId: string | null;
  onPreview: (segments: AudioSegment[]) => void;
  onChoose: (trackId: string) => void;
  onSkip: () => void;
  onMove: (direction: -1 | 1) => void;
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
  return (
    <article className={`sentence-row ${skipped ? "skipped" : ""}`}>
      <div className="sentence-number">
        {String(index + 1).padStart(2, "0")}
        <div className="reorder">
          <button
            aria-label={`Move sentence ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            aria-label={`Move sentence ${index + 1} down`}
            disabled={disabled || index === project.groups.length - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={12} />
          </button>
        </div>
      </div>
      <div className="sentence-body">
        <div className="sentence-heading">
          <h3>{group.text}</h3>
          <div className="sentence-tags">
            {variations.length < project.tracks.length && (
              <span className="unique-badge">
                {variations.length === 1
                  ? "Unique sentence"
                  : `${variations.length} of ${project.tracks.length} takes`}
              </span>
            )}
            {activeTracks.length > 1 && (
              <span className="custom-badge">Custom mix</span>
            )}
            {skipped && <span className="unique-badge">Skipped</span>}
            <button
              className="icon-button skip-button"
              disabled={disabled || skipped}
              onClick={onSkip}
              aria-label={`Skip sentence ${index + 1}`}
              title="Skip this sentence"
            >
              <VolumeX size={14} />
            </button>
          </div>
        </div>
        {group.note && <p className="sentence-note">{group.note}</p>}
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
                <div className="variation-top">
                  <span className="track-indicator" />
                  <span className="variation-name" title={track.name}>
                    {track.name}
                  </span>
                  <span className="variation-time">
                    {secondsLabel(
                      parts.reduce((n, s) => n + s.end - s.start, 0),
                    )}
                  </span>
                </div>
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
                </div>
                {parts.map((p) => p.text).join(" ") !== group.text && (
                  <p className="variation-text">
                    {parts.map((p) => p.text).join(" ")}
                  </p>
                )}
                <button
                  className={`choose-button ${chosen ? "selected" : ""}`}
                  disabled={disabled}
                  aria-label={`Use ${track.name} for sentence ${index + 1}`}
                  aria-pressed={chosen}
                  onClick={() => onChoose(track.id)}
                >
                  {chosen ? (
                    <Check size={12} />
                  ) : partial ? (
                    <SlidersHorizontal size={12} />
                  ) : (
                    <Plus size={12} />
                  )}
                  <span>
                    {chosen
                      ? "In your master"
                      : partial
                        ? "Custom selection · use full take"
                        : "Use take"}
                  </span>
                  {chosen && <span className="selected-dot" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function ManualTrack({
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
}

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
  const valid =
    Number.isFinite(Number(start)) &&
    Number.isFinite(Number(end)) &&
    Number(start) >= 0 &&
    Number(end) > Number(start) &&
    Number(end) <= track.duration;
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
        onClick={() => onTrim(Number(start), Number(end))}
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
