import { chmod, copyFile, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  newProject,
  parseProject,
  UnsupportedAudioSchemaError,
} from "../src/domain/project";
import type {
  MixProject,
  StudioTheme,
  WorkspaceSession,
  StudioPreferences,
} from "../src/shared/types";
import { atomicJSON } from "./media";

/** Only missing cached media may silently remove a structurally valid tab. */
export class UnavailableProjectMediaError extends Error {
  constructor() {
    super("This mix's cached audio is no longer available.");
    this.name = "UnavailableProjectMediaError";
  }
}

export function checkedTheme(value: unknown): StudioTheme {
  if (value !== "light" && value !== "dark" && value !== "system")
    throw new Error("Choose a supported appearance.");
  return value;
}

/** Serializes media writes while allowing transcription to run independently. */
export class ProjectTaskQueue {
  private queue: Promise<unknown> = Promise.resolve();
  private controllers = new Map<AbortController, string | undefined>();

  run<T>(
    action: (signal: AbortSignal) => Promise<T>,
    projectId?: string,
  ): Promise<T> {
    const controller = new AbortController();
    this.controllers.set(controller, projectId);
    let rejectCancelled!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    const abort = () => rejectCancelled(new Error("Operation cancelled."));
    controller.signal.addEventListener("abort", abort, { once: true });
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (controller.signal.aborted) throw new Error("Operation cancelled.");
        return action(controller.signal);
      });
    this.queue = task;
    return Promise.race([task, cancelled]).finally(() => {
      controller.signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    });
  }

  cancel(projectId?: string) {
    this.controllers.forEach((owner, controller) => {
      if (projectId === undefined || owner === projectId) controller.abort();
    });
  }

  flush(): Promise<unknown> {
    return this.queue;
  }
}

function workspaceInput(value: unknown): Record<string, unknown> & {
  projects: unknown[];
  closedProjects?: unknown[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The saved workspace is invalid.");
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    !Array.isArray(input.projects) ||
    !input.projects.length ||
    input.projects.length > 50
  )
    throw new Error("A workspace must contain between 1 and 50 mixes.");
  if (
    input.closedProjects !== undefined &&
    (!Array.isArray(input.closedProjects) || input.closedProjects.length > 20)
  )
    throw new Error("A workspace can keep up to 20 recently closed mixes.");
  if (
    typeof input.activeProjectId !== "string" ||
    !input.activeProjectId.length ||
    input.activeProjectId.length > 200
  )
    throw new Error("The active mix tab is missing from the workspace.");
  checkedTheme(input.theme);
  return input as Record<string, unknown> & {
    projects: unknown[];
    closedProjects?: unknown[];
  };
}

export function parseWorkspace(
  value: unknown,
  checkProject: (value: unknown) => MixProject = parseProject,
): WorkspaceSession {
  const input = workspaceInput(value);
  const projects = input.projects.map(checkProject);
  const closedProjects =
    (input.closedProjects as unknown[] | undefined)?.map(checkProject) || [];
  const ids = new Set(projects.map((project) => project.id));
  if (ids.size !== projects.length)
    throw new Error("The saved workspace contains duplicate mix tabs.");
  const closedIds = new Set(closedProjects.map((project) => project.id));
  if (
    closedIds.size !== closedProjects.length ||
    closedProjects.some((project) => ids.has(project.id))
  )
    throw new Error("The saved workspace contains duplicate closed mixes.");
  if (
    typeof input.activeProjectId !== "string" ||
    !ids.has(input.activeProjectId)
  )
    throw new Error("The active mix tab is missing from the workspace.");
  return {
    version: 1,
    projects,
    activeProjectId: input.activeProjectId,
    theme: checkedTheme(input.theme),
    closedProjects,
  };
}

/** Owns snapshots rather than individual asynchronous project results. */
export class WorkspaceStore {
  readonly filename: string;
  private session: WorkspaceSession | null = null;
  private loaded = false;
  private needsRecoveryBackup = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly checkProject: (value: unknown) => MixProject,
    private readonly write: typeof atomicJSON = atomicJSON,
    private readonly maxBytes = 100 * 1024 * 1024,
    private readonly restoreProject: (
      value: unknown,
    ) => Promise<MixProject> = async (value) => checkProject(value),
  ) {
    this.filename = path.join(root, "workspace-session.json");
  }

  private async read(filename: string): Promise<unknown> {
    if ((await stat(filename)).size > this.maxBytes)
      throw new Error("The saved workspace is too large to restore.");
    return JSON.parse(await readFile(filename, "utf8"));
  }

  async restore(): Promise<WorkspaceSession | null> {
    await this.flush();
    if (this.loaded) return this.session && structuredClone(this.session);
    let value: unknown;
    try {
      value = await this.read(this.filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.needsRecoveryBackup = true;
        throw error;
      }
      // Upgrade only when the workspace file does not exist. Keep the legacy
      // session untouched as a recovery copy, including when validation fails.
      try {
        const legacy = await this.read(
          path.join(this.root, "last-session.json"),
        );
        let project: MixProject;
        try {
          parseProject(legacy);
          project = await this.restoreProject(legacy);
        } catch (error) {
          if (
            !(error instanceof UnavailableProjectMediaError) &&
            !(error instanceof UnsupportedAudioSchemaError)
          )
            throw error;
          this.loaded = true;
          return null;
        }
        const migrated: WorkspaceSession = {
          version: 1,
          projects: [project],
          activeProjectId: project.id,
          theme: "light",
        };
        await this.save(migrated);
        return structuredClone(migrated);
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT")
          throw legacyError;
        this.loaded = true;
        return null;
      }
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Number.isInteger((value as Record<string, unknown>).version) &&
      Number((value as Record<string, unknown>).version) > 0 &&
      (value as Record<string, unknown>).version !== 1
    ) {
      // A newer schema belongs to a newer app. Start a fresh workspace and
      // retain its exact original bytes before any new autosave replaces it.
      this.needsRecoveryBackup = true;
      this.loaded = true;
      return null;
    }
    try {
      const input = workspaceInput(value);
      const openIds = new Set<string>();
      const closedIds = new Set<string>();
      let incompatibleOpen = false;
      const restoreTabs = async (projects: unknown[], closed = false) => {
        const restored: MixProject[] = [];
        for (const value of projects) {
          try {
            const project = parseProject(value);
            const ids = closed ? closedIds : openIds;
            if (ids.has(project.id) || (closed && openIds.has(project.id)))
              throw new Error(
                "The saved workspace contains duplicate mix tabs.",
              );
            ids.add(project.id);
            restored.push(await this.restoreProject(project));
          } catch (error) {
            if (
              !(error instanceof UnavailableProjectMediaError) &&
              !(error instanceof UnsupportedAudioSchemaError)
            )
              throw error;
            if (error instanceof UnsupportedAudioSchemaError && !closed)
              incompatibleOpen = true;
            this.needsRecoveryBackup = true;
          }
        }
        return restored;
      };
      const projects = await restoreTabs(input.projects);
      const closedProjects = await restoreTabs(
        input.closedProjects || [],
        true,
      );
      if (!openIds.has(input.activeProjectId as string) && !incompatibleOpen)
        throw new Error("The active mix tab is missing from the workspace.");
      if (!projects.length) projects.push(newProject());
      this.session = parseWorkspace({
        version: 1,
        theme: input.theme,
        projects,
        closedProjects,
        activeProjectId: projects.some(
          (project) => project.id === input.activeProjectId,
        )
          ? input.activeProjectId
          : projects[0].id,
      });
    } catch (error) {
      this.needsRecoveryBackup = true;
      throw error;
    }
    this.loaded = true;
    return structuredClone(this.session);
  }

  save(value: unknown): Promise<void> {
    const snapshot = parseWorkspace(value, this.checkProject);
    if (
      Buffer.byteLength(JSON.stringify(snapshot, null, 2), "utf8") >
      this.maxBytes
    )
      throw new Error(
        "The workspace is too large to save. Save projects separately and close a few tabs.",
      );
    this.session = snapshot;
    this.loaded = true;
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.needsRecoveryBackup) {
          const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
          const recovery = path.join(
            this.root,
            `workspace-session.recovery-${stamp}-${randomUUID()}.json`,
          );
          // Preserve exact bytes before replacing an unreadable workspace. A
          // failed backup blocks the replacement; existing recovery copies
          // are never overwritten or removed.
          try {
            await copyFile(this.filename, recovery, constants.COPYFILE_EXCL);
            await chmod(recovery, 0o600);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          this.needsRecoveryBackup = false;
        }
        await this.write(this.filename, snapshot);
      });
    return this.queue;
  }

  setTheme(value: unknown): Promise<void> {
    const theme = checkedTheme(value);
    return this.session
      ? this.save({ ...this.session, theme })
      : Promise.resolve();
  }

  flush(): Promise<void> {
    return this.queue;
  }

  activeProject(): MixProject | null {
    return (
      this.session?.projects.find(
        (project) => project.id === this.session?.activeProjectId,
      ) || null
    );
  }

  project(id: string): MixProject | null {
    return this.session?.projects.find((project) => project.id === id) || null;
  }
}

/** User-level onboarding state survives closing tabs and resetting a workspace. */
export class PreferencesStore {
  readonly filename: string;
  private contents: Record<string, unknown> = { version: 1 };
  private value: StudioPreferences = { hasExportedMaster: false };
  private initialization: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private needsRecoveryBackup = false;

  constructor(
    private readonly root: string,
    private readonly write: typeof atomicJSON = atomicJSON,
  ) {
    this.filename = path.join(root, "preferences.json");
  }

  private initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        try {
          if ((await stat(this.filename)).size > 1024 * 1024)
            throw new Error("The preferences file is too large.");
          const input: unknown = JSON.parse(
            await readFile(this.filename, "utf8"),
          );
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("The preferences file is invalid.");
          this.contents = input as Record<string, unknown>;
          this.value = {
            hasExportedMaster: this.contents.hasExportedMaster === true,
          };
        } catch (error) {
          this.needsRecoveryBackup =
            (error as NodeJS.ErrnoException).code !== "ENOENT";
        }
      })();
    }
    return this.initialization;
  }

  async get(): Promise<StudioPreferences> {
    await this.initialize();
    await this.queue.catch(() => undefined);
    return { ...this.value };
  }

  async recordSuccessfulExport(): Promise<void> {
    await this.initialize();
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.needsRecoveryBackup) {
          const recovery = path.join(
            this.root,
            `preferences.recovery-${randomUUID()}.json`,
          );
          await copyFile(this.filename, recovery, constants.COPYFILE_EXCL);
          await chmod(recovery, 0o600);
          this.needsRecoveryBackup = false;
        }
        const contents = {
          ...this.contents,
          version: 1,
          hasExportedMaster: true,
        };
        await this.write(this.filename, contents);
        this.contents = contents;
        this.value = { hasExportedMaster: true };
      });
    await this.queue;
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
