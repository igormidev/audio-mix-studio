import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newProject, parseProject } from "../src/domain/project";
import type { WorkspaceSession } from "../src/shared/types";
import { atomicJSON } from "../electron/media";
import {
  checkedTheme,
  parseWorkspace,
  ProjectTaskQueue,
  WorkspaceStore,
  UnavailableProjectMediaError,
  PreferencesStore,
} from "../electron/workspace";

describe("project-owned media operation queue", () => {
  it("cancels one tab's queued job without aborting the other tab's running operation", async () => {
    const queue = new ProjectTaskQueue();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstAborted = false;
    let cancelledRan = false;
    const first = queue.run(async (signal) => {
      started();
      await blocked;
      firstAborted = signal.aborted;
      return "first finished";
    }, "first-project");
    await entered;
    const cancelled = queue.run(async () => {
      cancelledRan = true;
      return "should not run";
    }, "second-project");
    const cancellation = expect(cancelled).rejects.toThrow("cancelled");
    queue.cancel("second-project");
    // Cancellation must finish while the earlier tab is still blocked.
    await cancellation;
    expect(cancelledRan).toBe(false);
    release();
    await expect(first).resolves.toBe("first finished");
    await cancellation;
    expect(firstAborted).toBe(false);
    expect(cancelledRan).toBe(false);
    await expect(
      queue.run(async () => "next job", "second-project"),
    ).resolves.toBe("next job");
  });

  it("aborts the selected running job and keeps another tab's queued job", async () => {
    const queue = new ProjectTaskQueue();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = queue.run(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
          started();
        }),
      "first-project",
    );
    await entered;
    const rejection = expect(first).rejects.toThrow("cancelled");
    const next = queue.run(
      async (signal) => ({ aborted: signal.aborted }),
      "second-project",
    );
    queue.cancel("first-project");
    await rejection;
    await expect(next).resolves.toEqual({ aborted: false });
    await queue.flush();
  });
});

function session(): WorkspaceSession {
  const first = newProject("Opening narration");
  const second = newProject("Closing narration");
  return {
    version: 1,
    projects: [first, second],
    activeProjectId: second.id,
    theme: "dark",
    closedProjects: [newProject("Recently closed")],
  };
}

describe("workspace snapshot validation", () => {
  it("preserves independent mixes, active tab, closed recovery, and appearance", () => {
    const input = session();
    expect(parseWorkspace(input)).toEqual(input);
  });

  it("validates authorized audio for open and closed tabs before accepting a snapshot", () => {
    const input = session();
    const checked: string[] = [];
    const restored = parseWorkspace(input, (value) => {
      const project = parseProject(value);
      checked.push(project.id);
      return project;
    });
    expect(checked).toEqual([
      ...input.projects.map((project) => project.id),
      input.closedProjects![0].id,
    ]);
    expect(restored.activeProjectId).toBe(input.activeProjectId);
    expect(() =>
      parseWorkspace(input, () => {
        throw new Error("An audio file is missing.");
      }),
    ).toThrow("audio file is missing");
  });

  it("rejects duplicate tabs, missing active IDs, malformed projects, and unsupported themes", () => {
    const input = session();
    expect(() =>
      parseWorkspace({
        ...input,
        projects: [input.projects[0], input.projects[0]],
      }),
    ).toThrow("duplicate");
    expect(() =>
      parseWorkspace({ ...input, activeProjectId: "missing" }),
    ).toThrow("active mix");
    expect(() => parseWorkspace({ ...input, projects: [{}] })).toThrow();
    expect(() => parseWorkspace({ ...input, theme: "sepia" })).toThrow(
      "appearance",
    );
    expect(() =>
      parseWorkspace({ ...input, closedProjects: [input.projects[0]] }),
    ).toThrow("duplicate closed");
    expect(() => parseWorkspace({ ...input, projects: [] })).toThrow(
      "between 1 and 50",
    );
    expect(() => checkedTheme({ source: "dark" })).toThrow("appearance");
  });
});

describe("atomic serialized workspace recovery", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), "mixstudio-workspace-test-"),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates the previous session once without changing its recovery file", async () => {
    const old = newProject("Existing mix with unsaved work");
    const original = JSON.stringify(old);
    await writeFile(path.join(directory, "last-session.json"), original);
    const store = new WorkspaceStore(directory, parseProject);
    const restored = await store.restore();
    expect(restored).toEqual({
      version: 1,
      projects: [old],
      activeProjectId: old.id,
      theme: "light",
    });
    expect(
      await readFile(path.join(directory, "last-session.json"), "utf8"),
    ).toBe(original);
    expect(JSON.parse(await readFile(store.filename, "utf8"))).toMatchObject({
      projects: [old],
    });
    const updated = session();
    await store.save(updated);
    expect(await new WorkspaceStore(directory, parseProject).restore()).toEqual(
      updated,
    );
  });

  it("does not fall back to an old project when an existing workspace is corrupt", async () => {
    const store = new WorkspaceStore(directory, parseProject);
    await writeFile(store.filename, "{broken workspace");
    await writeFile(
      path.join(directory, "last-session.json"),
      JSON.stringify(newProject("Old")),
    );
    await expect(store.restore()).rejects.toThrow();
    expect(await readFile(store.filename, "utf8")).toBe("{broken workspace");
  });

  it("preserves the exact unreadable workspace before autosaving a new session", async () => {
    const store = new WorkspaceStore(directory, parseProject);
    const original = Buffer.from(
      "{broken workspace\n  and recoverable original text\n",
    );
    await writeFile(store.filename, original);
    const existingRecovery = path.join(
      directory,
      "workspace-session.recovery-existing.json",
    );
    await writeFile(existingRecovery, "earlier recovery must remain");
    await expect(store.restore()).rejects.toThrow();
    const next = session();
    await Promise.all([store.save(next), store.setTheme("system")]);
    const recovery = (await readdir(directory)).filter(
      (filename) =>
        filename.startsWith("workspace-session.recovery-") &&
        !filename.includes("existing"),
    );
    expect(recovery).toHaveLength(1);
    expect(await readFile(path.join(directory, recovery[0]))).toEqual(original);
    expect(await readFile(existingRecovery, "utf8")).toBe(
      "earlier recovery must remain",
    );
    expect(
      (await new WorkspaceStore(directory, parseProject).restore())?.theme,
    ).toBe("system");
  });

  it("backs up a syntactically valid workspace with missing authorized media before replacement", async () => {
    const original = JSON.stringify(session(), null, 2);
    const store = new WorkspaceStore(directory, () => {
      throw new Error("An audio file is missing");
    });
    await writeFile(store.filename, original);
    await expect(store.restore()).rejects.toThrow("audio file is missing");
    // A newly imported project's validator becomes valid without touching the
    // retained original manifest; this simulates user recovery in the app.
    let allow = false;
    const recovering = new WorkspaceStore(directory, (value) => {
      if (!allow) throw new Error("An audio file is missing");
      return parseProject(value);
    });
    await expect(recovering.restore()).rejects.toThrow("audio file is missing");
    allow = true;
    await recovering.save(session());
    const recovery = (await readdir(directory)).find((name) =>
      name.startsWith("workspace-session.recovery-"),
    );
    expect(recovery).toBeTruthy();
    expect(await readFile(path.join(directory, recovery!), "utf8")).toBe(
      original,
    );
  });

  it("drops only unavailable open and closed tabs, keeping valid order and selecting a surviving active tab", async () => {
    const saved = session();
    const unavailable = saved.projects[1].id;
    const closedUnavailable = newProject(
      "Closed mix with deleted cached audio",
    );
    saved.closedProjects!.push(closedUnavailable);
    const filename = path.join(directory, "workspace-session.json");
    const original = JSON.stringify(saved);
    await writeFile(filename, original);
    const store = new WorkspaceStore(directory, (value) => {
      const project = parseProject(value);
      if ([unavailable, closedUnavailable.id].includes(project.id))
        throw new UnavailableProjectMediaError();
      return project;
    });
    const restored = await store.restore();
    expect(restored?.projects).toEqual([saved.projects[0]]);
    expect(restored?.activeProjectId).toBe(saved.projects[0].id);
    expect(restored?.closedProjects).toEqual([saved.closedProjects![0]]);
    expect(restored?.theme).toBe("dark");
    expect(await readFile(filename, "utf8")).toBe(original);
    await store.save(restored);
    const recovery = (await readdir(directory)).find((name) =>
      name.startsWith("workspace-session.recovery-"),
    );
    expect(await readFile(path.join(directory, recovery!), "utf8")).toBe(
      original,
    );
    expect(await new WorkspaceStore(directory, parseProject).restore()).toEqual(
      restored,
    );
  });

  it("keeps a valid active tab when another tab's asynchronous media check fails", async () => {
    const saved = session();
    await writeFile(
      path.join(directory, "workspace-session.json"),
      JSON.stringify(saved),
    );
    const store = new WorkspaceStore(
      directory,
      parseProject,
      atomicJSON,
      undefined,
      async (value) => {
        await Promise.resolve();
        const project = parseProject(value);
        if (project.id === saved.projects[0].id)
          throw new UnavailableProjectMediaError();
        return project;
      },
    );
    const restored = await store.restore();
    expect(restored?.projects).toEqual([saved.projects[1]]);
    expect(restored?.activeProjectId).toBe(saved.activeProjectId);
  });

  it("starts one blank tab when every open tab is missing media while retaining valid closed tabs", async () => {
    const saved = session();
    await writeFile(
      path.join(directory, "workspace-session.json"),
      JSON.stringify(saved),
    );
    const ids = new Set(saved.projects.map((project) => project.id));
    const store = new WorkspaceStore(directory, (value) => {
      const project = parseProject(value);
      if (ids.has(project.id)) throw new UnavailableProjectMediaError();
      return project;
    });
    const restored = await store.restore();
    expect(restored?.projects).toHaveLength(1);
    expect(restored?.projects[0].tracks).toEqual([]);
    expect(restored?.activeProjectId).toBe(restored?.projects[0].id);
    expect(restored?.closedProjects).toEqual(saved.closedProjects);
    expect(restored?.theme).toBe("dark");
  });

  it("quietly resets an unsupported numeric schema and preserves its exact bytes before replacement", async () => {
    const original = JSON.stringify({
      version: 2,
      futureFormat: { keep: "everything" },
    });
    const store = new WorkspaceStore(directory, parseProject);
    await writeFile(store.filename, original);
    await expect(store.restore()).resolves.toBeNull();
    expect(await readFile(store.filename, "utf8")).toBe(original);
    await store.save(session());
    const recovery = (await readdir(directory)).find((name) =>
      name.startsWith("workspace-session.recovery-"),
    );
    expect(await readFile(path.join(directory, recovery!), "utf8")).toBe(
      original,
    );
  });

  it("silently omits only incompatible project schemas and preserves unrelated valid mixes", async () => {
    const saved = session();
    const original = JSON.stringify({
      ...saved,
      projects: [saved.projects[0], { ...saved.projects[1], audioSchema: 3 }],
      closedProjects: [
        saved.closedProjects![0],
        { ...newProject("Future closed mix"), version: 2 },
      ],
    });
    const store = new WorkspaceStore(directory, parseProject);
    await writeFile(store.filename, original);
    const restored = await store.restore();
    expect(restored?.projects).toEqual([saved.projects[0]]);
    expect(restored?.closedProjects).toEqual(saved.closedProjects);
    expect(restored?.activeProjectId).toBe(saved.projects[0].id);
    await store.save(restored);
    const recovery = (await readdir(directory)).find((name) =>
      name.startsWith("workspace-session.recovery-"),
    );
    expect(await readFile(path.join(directory, recovery!), "utf8")).toBe(
      original,
    );
  });

  it("quietly creates a fresh mix when every saved tab uses an unsupported project schema", async () => {
    const saved = session();
    const store = new WorkspaceStore(directory, parseProject);
    await writeFile(
      store.filename,
      JSON.stringify({
        ...saved,
        projects: saved.projects.map((project) => ({
          ...project,
          audioSchema: 3,
        })),
        closedProjects: [],
      }),
    );
    const restored = await store.restore();
    expect(restored?.projects).toHaveLength(1);
    expect(restored?.projects[0].tracks).toEqual([]);
    expect(restored?.projects[0].audioSchema).toBe(2);
  });

  it("quietly skips incompatible legacy schemas without modifying the legacy file", async () => {
    const legacy = path.join(directory, "last-session.json");
    const original = JSON.stringify({ ...newProject(), audioSchema: 3 });
    await writeFile(legacy, original);
    await expect(
      new WorkspaceStore(directory, parseProject).restore(),
    ).resolves.toBeNull();
    expect(await readFile(legacy, "utf8")).toBe(original);
  });

  it("retains malformed current-schema errors instead of disguising them as missing audio", async () => {
    const saved = session();
    const malformed = {
      ...saved,
      projects: [...saved.projects, { version: 1 }],
    };
    const store = new WorkspaceStore(directory, () => {
      throw new UnavailableProjectMediaError();
    });
    await writeFile(store.filename, JSON.stringify(malformed));
    await expect(store.restore()).rejects.not.toBeInstanceOf(
      UnavailableProjectMediaError,
    );
    expect(JSON.parse(await readFile(store.filename, "utf8"))).toEqual(
      malformed,
    );
  });

  it("silently skips an unavailable legacy tab while leaving the legacy recovery file untouched", async () => {
    const original = JSON.stringify(newProject("Legacy missing cached audio"));
    const legacy = path.join(directory, "last-session.json");
    await writeFile(legacy, original);
    const store = new WorkspaceStore(directory, () => {
      throw new UnavailableProjectMediaError();
    });
    await expect(store.restore()).resolves.toBeNull();
    expect(await readFile(legacy, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["last-session.json"]);
  });

  it("keeps invalid legacy data untouched and never creates a replacement workspace", async () => {
    const filename = path.join(directory, "last-session.json");
    await writeFile(filename, JSON.stringify({ version: 1, tracks: [] }));
    const store = new WorkspaceStore(directory, parseProject);
    await expect(store.restore()).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["last-session.json"]);
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual({
      version: 1,
      tracks: [],
    });
  });

  it("serializes rapid edits and theme changes so the newest snapshot wins", async () => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const store = new WorkspaceStore(
      directory,
      parseProject,
      async (filename, value) => {
        writes++;
        if (writes === 1) {
          started();
          await blocked;
        }
        await atomicJSON(filename, value);
      },
    );
    const first = session();
    const saveFirst = store.save(first);
    await entered;
    const second = structuredClone(first);
    second.projects[0].name = "Latest edit in the background tab";
    second.activeProjectId = second.projects[0].id;
    const saveSecond = store.save(second);
    const saveTheme = store.setTheme("system");
    second.projects[0].name = "Mutation after the host received its snapshot";
    expect(writes).toBe(1);
    release();
    await Promise.all([saveFirst, saveSecond, saveTheme]);
    const restored = await new WorkspaceStore(
      directory,
      parseProject,
    ).restore();
    expect(restored?.projects[0].name).toBe(
      "Latest edit in the background tab",
    );
    expect(restored?.activeProjectId).toBe(first.projects[0].id);
    expect(restored?.theme).toBe("system");
    expect(restored?.closedProjects).toEqual(first.closedProjects);
    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("retains the last good file after a rejected save and accepts the next valid snapshot", async () => {
    const store = new WorkspaceStore(directory, parseProject);
    const good = session();
    await store.save(good);
    const original = await readFile(store.filename, "utf8");
    expect(() => store.save({ ...good, activeProjectId: "unknown" })).toThrow();
    expect(await readFile(store.filename, "utf8")).toBe(original);

    let fail = true;
    const recovering = new WorkspaceStore(
      directory,
      parseProject,
      async (filename, value) => {
        if (fail) {
          fail = false;
          throw new Error("Disk write failed");
        }
        await atomicJSON(filename, value);
      },
    );
    await expect(recovering.save({ ...good, theme: "light" })).rejects.toThrow(
      "Disk write",
    );
    expect(await readFile(store.filename, "utf8")).toBe(original);
    await recovering.save({ ...good, theme: "system" });
    expect(
      (await new WorkspaceStore(directory, parseProject).restore())?.theme,
    ).toBe("system");
  });

  it("rejects snapshots above its restoration byte limit before replacing the last good file", async () => {
    const good = session();
    const limit = Buffer.byteLength(JSON.stringify(good, null, 2), "utf8") + 10;
    const store = new WorkspaceStore(
      directory,
      parseProject,
      atomicJSON,
      limit,
    );
    await store.save(good);
    const original = await readFile(store.filename, "utf8");
    const oversized = structuredClone(good);
    oversized.projects[0].name = "A long project name ".repeat(30);
    expect(() => store.save(oversized)).toThrow("too large to save");
    expect(await readFile(store.filename, "utf8")).toBe(original);
    expect(
      await new WorkspaceStore(
        directory,
        parseProject,
        atomicJSON,
        limit,
      ).restore(),
    ).toEqual(good);
  });
});

describe("durable master-export preference", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), "mixstudio-preferences-test-"),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("starts false, records only a successful export, and survives workspace replacement and restart", async () => {
    const store = new PreferencesStore(directory);
    expect(await store.get()).toEqual({ hasExportedMaster: false });
    expect(await readdir(directory)).toEqual([]);
    await store.recordSuccessfulExport();
    const workspace = new WorkspaceStore(directory, parseProject);
    await workspace.save(session());
    await writeFile(workspace.filename, JSON.stringify({ version: 2 }));
    expect(
      await new WorkspaceStore(directory, parseProject).restore(),
    ).toBeNull();
    expect(await new PreferencesStore(directory).get()).toEqual({
      hasExportedMaster: true,
    });
  });

  it("preserves unrelated preference fields and unreadable preference recovery bytes", async () => {
    const filename = path.join(directory, "preferences.json");
    await writeFile(
      filename,
      JSON.stringify({
        version: 1,
        hasExportedMaster: false,
        anotherSetting: "keep",
      }),
    );
    await new PreferencesStore(directory).recordSuccessfulExport();
    expect(JSON.parse(await readFile(filename, "utf8"))).toEqual({
      version: 1,
      hasExportedMaster: true,
      anotherSetting: "keep",
    });
    await writeFile(filename, "{invalid original preferences");
    const recovering = new PreferencesStore(directory);
    expect(await recovering.get()).toEqual({ hasExportedMaster: false });
    await recovering.recordSuccessfulExport();
    const recovery = (await readdir(directory)).find((name) =>
      name.startsWith("preferences.recovery-"),
    );
    expect(await readFile(path.join(directory, recovery!), "utf8")).toBe(
      "{invalid original preferences",
    );
    expect(await new PreferencesStore(directory).get()).toEqual({
      hasExportedMaster: true,
    });
  });

  it("does not claim a durable export marker when persistence fails", async () => {
    const store = new PreferencesStore(directory, async () => {
      throw new Error("Disk unavailable");
    });
    await expect(store.recordSuccessfulExport()).rejects.toThrow(
      "Disk unavailable",
    );
    expect(await store.get()).toEqual({ hasExportedMaster: false });
    expect(await new PreferencesStore(directory).get()).toEqual({
      hasExportedMaster: false,
    });
    expect(await readdir(directory)).toEqual([]);
  });
});
