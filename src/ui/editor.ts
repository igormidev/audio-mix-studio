import type { MixProject } from "../shared/types";

const HISTORY_LIMIT = 80;

export interface EditorState {
  project: MixProject;
  past: MixProject[];
  future: MixProject[];
  error: string | null;
}

export type EditorAction =
  | { type: "adopt"; project: MixProject; reset?: boolean; now?: string }
  | { type: "edit"; update: (project: MixProject) => MixProject; now?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "dismissError" };

export function initialEditor(project: MixProject): EditorState {
  return { project, past: [], future: [], error: null };
}

function stamped(project: MixProject, now?: string): MixProject {
  return now && now !== project.updatedAt
    ? { ...project, updatedAt: now }
    : project;
}

/** Keep the project and its undo history in one atomic React state transition. */
export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "adopt": {
      if (action.reset) {
        if (
          action.project === state.project &&
          !state.past.length &&
          !state.future.length &&
          !state.error
        )
          return state;
        return initialEditor(stamped(action.project, action.now));
      }
      if (action.project === state.project) return state;
      return {
        project: stamped(action.project, action.now),
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: [],
        error: null,
      };
    }
    case "edit": {
      try {
        const project = action.update(state.project);
        if (project === state.project) return state;
        return {
          project: stamped(project, action.now),
          past: [...state.past, state.project].slice(-HISTORY_LIMIT),
          future: [],
          error: null,
        };
      } catch (error) {
        return {
          ...state,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case "undo": {
      if (!state.past.length) return state;
      return {
        project: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        error: null,
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      return {
        project: state.future[0],
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        error: null,
      };
    }
    case "dismissError":
      return state.error ? { ...state, error: null } : state;
  }
}
