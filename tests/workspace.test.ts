import { describe, expect, it } from "vitest";
import { newProject } from "../src/domain/project";
import {
  initialWorkspace,
  workspaceReducer,
  workspaceSession,
} from "../src/ui/workspaceState";

describe("independent project tabs", () => {
  it("keeps undo histories and asynchronous results attached to their origin", () => {
    const a = newProject("First"),
      b = newProject("Second");
    let state = initialWorkspace({
      version: 1,
      projects: [a, b],
      activeProjectId: a.id,
      theme: "dark",
    });
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: {
        type: "edit",
        update: (p) => ({ ...p, name: "Changed first" }),
      },
    });
    state = workspaceReducer(state, { type: "activate", id: b.id });
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: { type: "adopt", project: { ...a, name: "Finished analysis" } },
    });
    expect(state.activeId).toBe(b.id);
    expect(state.editors[1].project).toBe(b);
    expect(state.editors[1].past).toHaveLength(0);
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: { type: "undo" },
    });
    expect(state.editors[0].project.name).toBe("Changed first");
  });
  it("closes without losing the snapshot or history, then reopens it", () => {
    const a = newProject("Keep me"),
      b = newProject("Second");
    let state = initialWorkspace({
      version: 1,
      projects: [a, b],
      activeProjectId: a.id,
      theme: "light",
    });
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: { type: "edit", update: (p) => ({ ...p, joinFadeMs: 12 }) },
    });
    state = workspaceReducer(state, {
      type: "close",
      id: a.id,
      replacement: newProject(),
    });
    expect(state.activeId).toBe(b.id);
    expect(workspaceSession(state).closedProjects?.[0].joinFadeMs).toBe(12);
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: { type: "adopt", project: a },
    });
    expect(state.editors).toHaveLength(1);
    state = workspaceReducer(state, { type: "reopen" });
    expect(state.activeId).toBe(a.id);
    state = workspaceReducer(state, {
      type: "editor",
      id: a.id,
      action: { type: "undo" },
    });
    expect(state.editors[1].project.joinFadeMs).toBe(a.joinFadeMs);
  });
  it("restores tabs, closed snapshots, names, active selection, and appearance", () => {
    const a = newProject("One"),
      b = newProject("Two");
    let state = initialWorkspace({
      version: 1,
      projects: [a, b],
      activeProjectId: b.id,
      theme: "system",
    });
    state = workspaceReducer(state, {
      type: "close",
      id: a.id,
      replacement: newProject(),
    });
    const restored = initialWorkspace(
      JSON.parse(JSON.stringify(workspaceSession(state))),
    );
    expect(restored.activeId).toBe(b.id);
    expect(restored.theme).toBe("system");
    expect(restored.closed[0].project.name).toBe("One");
    expect(workspaceReducer(restored, { type: "reopen" }).editors).toHaveLength(
      2,
    );
  });
  it("always leaves a usable tab and prevents duplicate open project identities", () => {
    const state = initialWorkspace(),
      replacement = newProject();
    const closed = workspaceReducer(state, {
      type: "close",
      id: state.activeId,
      replacement,
    });
    expect(closed.editors[0].project).toBe(replacement);
    expect(closed.activeId).toBe(replacement.id);
    const reopened = workspaceReducer(closed, { type: "reopen" });
    expect(
      workspaceReducer(reopened, { type: "add", project: replacement }).editors,
    ).toHaveLength(2);
  });
});
