import { newProject } from "../domain/project";
import type {
  MixProject,
  StudioTheme,
  WorkspaceSession,
} from "../shared/types";
import {
  editorReducer,
  initialEditor,
  type EditorAction,
  type EditorState,
} from "./editor";

export interface WorkspaceState {
  editors: EditorState[];
  closed: EditorState[];
  activeId: string;
  theme: StudioTheme;
}
export type WorkspaceAction =
  | { type: "restore"; session: WorkspaceSession }
  | { type: "add"; project: MixProject }
  | { type: "activate"; id: string }
  | { type: "close"; id: string; replacement: MixProject }
  | { type: "reopen" }
  | { type: "theme"; theme: StudioTheme }
  | { type: "editor"; id: string; action: EditorAction };

export function initialWorkspace(session?: WorkspaceSession): WorkspaceState {
  const projects = session?.projects.length ? session.projects : [newProject()];
  return {
    editors: projects.map(initialEditor),
    closed: (session?.closedProjects ?? []).slice(0, 20).map(initialEditor),
    activeId: projects.some((p) => p.id === session?.activeProjectId)
      ? session!.activeProjectId
      : projects[0].id,
    theme: session?.theme ?? "light",
  };
}
export function workspaceSession(state: WorkspaceState): WorkspaceSession {
  return {
    version: 1,
    projects: state.editors.map((e) => e.project),
    closedProjects: state.closed.map((e) => e.project),
    activeProjectId: state.activeId,
    theme: state.theme,
  };
}
export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "restore":
      return initialWorkspace(action.session);
    case "add": {
      const existing = state.editors.find(
        (e) => e.project.id === action.project.id,
      );
      if (existing) return { ...state, activeId: existing.project.id };
      if (state.editors.length >= 50) return state;
      return {
        ...state,
        editors: [...state.editors, initialEditor(action.project)],
        activeId: action.project.id,
        closed: state.closed.filter((e) => e.project.id !== action.project.id),
      };
    }
    case "activate":
      return state.editors.some((e) => e.project.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case "close": {
      const index = state.editors.findIndex((e) => e.project.id === action.id);
      if (index < 0) return state;
      const closed = [
        state.editors[index],
        ...state.closed.filter((e) => e.project.id !== action.id),
      ].slice(0, 20);
      const remaining = state.editors.filter((e) => e.project.id !== action.id);
      const editors = remaining.length
        ? remaining
        : [initialEditor(action.replacement)];
      return {
        ...state,
        editors,
        closed,
        activeId:
          state.activeId === action.id
            ? editors[Math.min(index, editors.length - 1)].project.id
            : state.activeId,
      };
    }
    case "reopen": {
      const [editor, ...closed] = state.closed;
      if (!editor || state.editors.length >= 50) return state;
      return {
        ...state,
        closed,
        editors: [...state.editors, editor],
        activeId: editor.project.id,
      };
    }
    case "theme":
      return state.theme === action.theme
        ? state
        : { ...state, theme: action.theme };
    case "editor": {
      const index = state.editors.findIndex((e) => e.project.id === action.id);
      if (index < 0) return state; // A stale async result never resurrects a closed tab.
      const next = editorReducer(state.editors[index], action.action);
      if (next === state.editors[index]) return state;
      const editors = [...state.editors];
      editors[index] = next;
      return { ...state, editors };
    }
  }
}
