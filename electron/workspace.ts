import { chmod, copyFile, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseProject } from "../src/domain/project";
import type {
  MixProject,
  StudioTheme,
  WorkspaceSession,
} from "../src/shared/types";
import { atomicJSON } from "./media";

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

export function parseWorkspace(
  value: unknown,
  checkProject: (value: unknown) => MixProject = parseProject,
): WorkspaceSession {
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
  const projects = input.projects.map(checkProject);
  if (
    input.closedProjects !== undefined &&
    (!Array.isArray(input.closedProjects) || input.closedProjects.length > 20)
  )
    throw new Error("A workspace can keep up to 20 recently closed mixes.");
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
        const project = this.checkProject(
          await this.read(path.join(this.root, "last-session.json")),
        );
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
    try {
      this.session = parseWorkspace(value, this.checkProject);
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
