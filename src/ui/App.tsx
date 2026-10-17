import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { AudioLines, LoaderCircle, Moon, Plus, Sun, X } from "lucide-react";
import { newProject } from "../domain/project";
import type { MixProject, StudioTheme } from "../shared/types";
import type { EditorAction } from "./editor";
import { Workspace } from "./Workspace";
import {
  initialWorkspace,
  workspaceReducer,
  workspaceSession,
} from "./workspaceState";

export function App() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    initialWorkspace(),
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [hasExportedMaster, setHasExportedMaster] = useState(true);
  const [demoRequest, setDemoRequest] = useState({ id: "", nonce: 0 });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const resolvedTheme =
    state.theme === "system" ? (systemDark ? "dark" : "light") : state.theme;

  useEffect(() => {
    let active = true;
    void window.studio
      .preferences()
      .then((preferences) => {
        if (active) setHasExportedMaster(preferences.hasExportedMaster);
      })
      .catch((e) => {
        if (active) setError(`Could not read settings: ${String(e)}`);
      });
    void window.studio
      .restoreWorkspace()
      .then((session) => {
        if (!active) return;
        if (session) dispatch({ type: "restore", session });
        setReady(true);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void window.studio.autosaveWorkspace(workspaceSession(state)).catch((e) => {
      if (active) {
        setError(
          `Could not save tabs: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [state, ready]);
  useEffect(() => {
    if (ready)
      void window.studio
        .setTheme(state.theme)
        .catch((e) => setError(String(e)));
  }, [state.theme, ready]);

  const onOpenProject = useCallback(
    (project: MixProject) => dispatch({ type: "add", project }),
    [],
  );
  const onThemeChange = useCallback(
    (theme: StudioTheme) => dispatch({ type: "theme", theme }),
    [],
  );
  const onBusyChange = useCallback((id: string, working: boolean) => {
    busyRef.current = { ...busyRef.current, [id]: working };
    setBusy(busyRef.current);
    if (!working)
      setDemoRequest((previous) =>
        previous.id === id ? { ...previous, id: "" } : previous,
      );
  }, []);
  const onEdit = useCallback(
    (id: string, action: EditorAction) =>
      dispatch({ type: "editor", id, action }),
    [],
  );
  const onExported = useCallback(() => setHasExportedMaster(true), []);
  const onRequestDemo = useCallback(() => {
    const current = stateRef.current;
    const activeEditor = current.editors.find(
      (e) => e.project.id === current.activeId,
    );
    const empty =
      activeEditor &&
      !activeEditor.project.tracks.length &&
      !busyRef.current[activeEditor.project.id]
        ? activeEditor
        : current.editors.find(
            (e) => !e.project.tracks.length && !busyRef.current[e.project.id],
          );
    if (!empty && current.editors.length >= 50) {
      setError("Close a tab before opening the sample (50 maximum).");
      return;
    }
    const project = empty?.project ?? newProject();
    dispatch({ type: "add", project });
    setDemoRequest((previous) => ({
      id: project.id,
      nonce: previous.nonce + 1,
    }));
  }, []);
  const close = useCallback((id: string) => {
    if (busyRef.current[id]) return;
    dispatch({ type: "close", id, replacement: newProject() });
  }, []);
  const add = useCallback(() => {
    if (stateRef.current.editors.length >= 50) {
      setError("Close a tab before opening another (50 maximum).");
      return;
    }
    dispatch({ type: "add", project: newProject() });
  }, []);
  useEffect(() => {
    const shortcut = (event: Event) => {
      if (!ready || document.querySelector('[role="dialog"]')) return;
      const action = (event as CustomEvent<string>).detail;
      const current = stateRef.current;
      if (action === "new") add();
      if (action === "close-tab") close(current.activeId);
      if (action === "reopen-tab") dispatch({ type: "reopen" });
      if (action === "next-tab" || action === "previous-tab") {
        const index = current.editors.findIndex(
          (e) => e.project.id === current.activeId,
        );
        const next =
          (index + (action === "next-tab" ? 1 : -1) + current.editors.length) %
          current.editors.length;
        dispatch({ type: "activate", id: current.editors[next].project.id });
      }
    };
    window.addEventListener("studio-shortcut", shortcut);
    return () => window.removeEventListener("studio-shortcut", shortcut);
  }, [ready, close, add]);

  return (
    <div className="studio-shell">
      <header className="studio-tabbar">
        <div
          className="studio-tabs"
          role="tablist"
          aria-label="Projects"
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
              (event.target as HTMLElement).tagName === "INPUT"
            )
              return;
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              ),
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          {state.editors.map((editor) => (
            <ProjectTab
              key={editor.project.id}
              project={editor.project}
              active={state.activeId === editor.project.id}
              busy={!!busy[editor.project.id]}
              onActivate={(id) => dispatch({ type: "activate", id })}
              onClose={close}
              onRename={(id, name) =>
                onEdit(id, {
                  type: "edit",
                  update: (project) => ({ ...project, name }),
                  now: new Date().toISOString(),
                })
              }
            />
          ))}
        </div>
        <button
          className="studio-new-tab icon-button"
          aria-label="New tab"
          title="New tab · ⌘N"
          disabled={!ready || state.editors.length >= 50}
          onClick={add}
        >
          <Plus size={17} />
        </button>
        <button
          className="studio-theme-toggle icon-button"
          aria-label={
            resolvedTheme === "dark" ? "Use light mode" : "Use dark mode"
          }
          title={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          onClick={() =>
            onThemeChange(resolvedTheme === "dark" ? "light" : "dark")
          }
          disabled={!ready}
        >
          {resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>
      <div className="studio-shell-content">
        {error && (
          <div className="workspace-save-error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss workspace error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {ready ? (
          state.editors.map((editor) => (
            <WorkspaceSlot
              key={editor.project.id}
              editor={editor}
              active={editor.project.id === state.activeId}
              theme={state.theme}
              onThemeChange={onThemeChange}
              onOpenProject={onOpenProject}
              onBusyChange={onBusyChange}
              onEdit={onEdit}
              showQuickGuide={!hasExportedMaster}
              onExported={onExported}
              onRequestDemo={onRequestDemo}
              demoRequest={
                demoRequest.id === editor.project.id ? demoRequest.nonce : 0
              }
            />
          ))
        ) : (
          <div className="studio-loading" role="status">
            <LoaderCircle className="spin" size={22} />
            <span>Opening tabs…</span>
          </div>
        )}
      </div>
    </div>
  );
}

const WorkspaceSlot = memo(function WorkspaceSlot({
  editor,
  onEdit,
  ...props
}: Omit<React.ComponentProps<typeof Workspace>, "dispatch"> & {
  onEdit: (id: string, action: EditorAction) => void;
}) {
  const id = editor.project.id;
  const dispatch = useCallback(
    (action: EditorAction) => onEdit(id, action),
    [onEdit, id],
  );
  return <Workspace {...props} editor={editor} dispatch={dispatch} />;
});

function ProjectTab({
  project,
  active,
  busy,
  onActivate,
  onClose,
  onRename,
}: {
  project: MixProject;
  active: boolean;
  busy: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const committed = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (active)
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const finish = () => {
    if (committed.current || draft === null) return;
    committed.current = true;
    const name = draft.trim();
    if (name && name !== project.name) onRename(project.id, name);
    setDraft(null);
  };
  return (
    <div ref={ref} className={`studio-project-tab ${active ? "active" : ""}`}>
      {draft === null ? (
        <button
          className="studio-tab-label"
          role="tab"
          id={`project-tab-${project.id}`}
          aria-controls={`project-panel-${project.id}`}
          aria-selected={active}
          tabIndex={active ? 0 : -1}
          title={`${project.name} · Double-click to rename`}
          onClick={() => onActivate(project.id)}
          onDoubleClick={() => {
            if (!busy) {
              committed.current = false;
              setDraft(project.name);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "F2" && !busy) {
              event.preventDefault();
              committed.current = false;
              setDraft(project.name);
            }
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <AudioLines size={13} />
          )}
          <span>{project.name}</span>
        </button>
      ) : (
        <input
          ref={input}
          className="studio-tab-rename"
          aria-label="Rename tab"
          maxLength={120}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finish}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              finish();
            }
            if (event.key === "Escape") {
              committed.current = true;
              setDraft(null);
            }
          }}
        />
      )}
      <button
        className="studio-tab-close"
        aria-label={`Close ${project.name}`}
        title={
          busy
            ? "Wait for this operation or cancel it before closing"
            : "Close tab · ⌘W"
        }
        disabled={busy}
        onClick={() => onClose(project.id)}
      >
        <X size={13} />
      </button>
    </div>
  );
}
