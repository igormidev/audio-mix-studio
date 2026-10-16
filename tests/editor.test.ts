import { describe, expect, it } from "vitest";
import {
  appendTracks,
  chooseVariation,
  moveGroup,
  newProject,
  splitSegment,
  toggleSegment,
} from "../src/domain/project";
import type { AudioTrack, MixProject } from "../src/shared/types";
import { editorReducer, initialEditor } from "../src/ui/editor";

function sample(): MixProject {
  const tracks: AudioTrack[] = ["a", "b"].map((id) => ({
    id,
    name: `Take ${id}`,
    duration: 10,
    color: "#557799",
    peaks: [],
    mediaUrl: `mixmedia://audio/${id}`,
  }));
  return appendTracks(newProject(), tracks);
}

describe("atomic editor history", () => {
  it("applies rapid sequential edits against the latest project and undoes every step once", () => {
    const original = sample();
    let state = initialEditor(original);
    state = editorReducer(state, {
      type: "edit",
      update: (p) => toggleSegment(p, p.segments[0].id),
    });
    const first = state.project;
    state = editorReducer(state, {
      type: "edit",
      update: (p) => toggleSegment(p, p.segments[1].id),
    });
    const second = state.project;
    expect(state.project.segments.map((segment) => segment.enabled)).toEqual([
      false,
      false,
    ]);
    expect(state.past).toEqual([original, first]);
    state = editorReducer(state, { type: "undo" });
    expect(state.project).toBe(first);
    state = editorReducer(state, { type: "undo" });
    expect(state.project).toBe(original);
    expect(state.future).toEqual([first, second]);
    expect(editorReducer(state, { type: "undo" })).toBe(state);
    state = editorReducer(state, { type: "redo" });
    state = editorReducer(state, { type: "redo" });
    expect(state.project).toBe(second);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("keeps split and choice edits together when they are dispatched before a React render", () => {
    let state = initialEditor(sample());
    const groupId = state.project.groups[0].id;
    state = editorReducer(state, {
      type: "edit",
      update: (p) => splitSegment(p, p.groups[0].segmentIds[0], 4),
    });
    state = editorReducer(state, {
      type: "edit",
      update: (p) => chooseVariation(p, groupId, "a"),
    });
    expect(state.project.groups[0].segmentIds).toHaveLength(2);
    expect(
      state.project.segments
        .filter((segment) => segment.groupId === groupId)
        .every((segment) => segment.enabled),
    ).toBe(true);
    state = editorReducer(state, { type: "undo" });
    state = editorReducer(state, { type: "undo" });
    expect(state.project.groups[0].segmentIds).toHaveLength(1);
  });

  it("clears the redo branch on a new edit", () => {
    let state = initialEditor(sample());
    state = editorReducer(state, {
      type: "edit",
      update: (p) => ({ ...p, name: "First" }),
    });
    state = editorReducer(state, {
      type: "edit",
      update: (p) => ({ ...p, name: "Second" }),
    });
    state = editorReducer(state, { type: "undo" });
    state = editorReducer(state, {
      type: "edit",
      update: (p) => ({ ...p, name: "A different second" }),
    });
    expect(state.future).toEqual([]);
    expect(editorReducer(state, { type: "redo" })).toBe(state);
  });

  it("does not record no-op edits or manufacture timestamps inside the reducer", () => {
    const state = initialEditor(sample());
    expect(editorReducer(state, { type: "edit", update: (p) => p })).toBe(
      state,
    );
    expect(
      editorReducer(state, {
        type: "edit",
        update: (p) => moveGroup(p, p.groups[0].id, -1),
      }),
    ).toBe(state);
    expect(
      editorReducer(state, { type: "adopt", project: state.project }),
    ).toBe(state);
    const action = {
      type: "edit" as const,
      now: "2026-10-16T00:00:00.000Z",
      update: (p: MixProject) => ({ ...p, name: "Renamed" }),
    };
    const once = editorReducer(state, action);
    const repeated = editorReducer(state, action);
    expect(once).toEqual(repeated);
    expect(once.project.updatedAt).toBe(action.now);
    expect(state.project.name).not.toBe("Renamed");
  });

  it("adopts async results into history and resets history when opening another project", () => {
    let state = initialEditor(sample());
    const original = state.project;
    const analyzed = { ...original, name: "Analyzed mix" };
    state = editorReducer(state, { type: "adopt", project: analyzed });
    expect(state.past).toEqual([original]);
    const loaded = newProject("Other mix");
    state = editorReducer(state, {
      type: "adopt",
      project: loaded,
      reset: true,
    });
    expect(state).toEqual(initialEditor(loaded));
    expect(editorReducer(state, { type: "undo" })).toBe(state);
  });

  it("bounds history without losing the newest transitions", () => {
    let state = initialEditor(sample());
    for (let index = 1; index <= 85; index++) {
      state = editorReducer(state, {
        type: "edit",
        update: (p) => ({ ...p, name: `Edit ${index}` }),
      });
    }
    expect(state.past).toHaveLength(80);
    expect(state.past[0].name).toBe("Edit 5");
    for (let index = 0; index < 80; index++)
      state = editorReducer(state, { type: "undo" });
    expect(state.project.name).toBe("Edit 5");
  });

  it("reports invalid manual edits without crashing React or altering project/history", () => {
    const original = initialEditor(sample());
    const failed = editorReducer(original, {
      type: "edit",
      update: (p) => splitSegment(p, p.segments[0].id, 0),
    });
    expect(failed.project).toBe(original.project);
    expect(failed.past).toBe(original.past);
    expect(failed.future).toBe(original.future);
    expect(failed.error).toMatch(/inside/);
    const dismissed = editorReducer(failed, { type: "dismissError" });
    expect(dismissed).toEqual(original);
    expect(editorReducer(dismissed, { type: "dismissError" })).toBe(dismissed);
    const recovered = editorReducer(failed, {
      type: "edit",
      update: (p) => toggleSegment(p, p.segments[0].id),
    });
    expect(recovered.error).toBeNull();
    expect(recovered.past).toHaveLength(1);
  });
});
