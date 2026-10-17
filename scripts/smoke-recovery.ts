/** Real production IPC with isolated generated audio; never touches the user's profile. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
} from "@playwright/test";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendTracks, newProject } from "../src/domain/project";
import type { WorkspaceSession } from "../src/shared/types";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-recovery-"));
const profile = path.join(temporary, "profile");
const source = path.join(temporary, "generated-tone.wav");
const exported = path.join(temporary, "master.wav");
let app: ElectronApplication | null = null;

async function launch() {
  app = await electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: root,
    chromiumSandbox: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  const page = await app.firstWindow();
  await page.getByRole("tablist", { name: "Projects", exact: true }).waitFor();
  await expect
    .poll(() => page.evaluate(() => typeof window.studio.preferences))
    .toBe("function");
  await expect(page.getByText("Opening tabs…", { exact: true })).toHaveCount(0);
  return page;
}
async function close() {
  await app?.close();
  app = null;
}

try {
  const ffmpeg = await findBinary("ffmpeg");
  await runProcess(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1.4",
    "-ar",
    "48000",
    source,
  ]);
  let page = await launch();
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: false,
  });
  const tracks = [];
  for (let index = 0; index < 4; index++) {
    const imported = await page.evaluate(
      (filename) => window.studio.importPaths([filename]),
      source,
    );
    tracks.push(imported[0]);
  }
  const projects = tracks.map((track, index) =>
    appendTracks(newProject(`Recovery fixture ${index + 1}`), [track]),
  );
  const original: WorkspaceSession = {
    version: 1,
    projects: projects.slice(0, 2),
    closedProjects: projects.slice(2),
    activeProjectId: projects[1].id,
    theme: "dark",
  };
  await page.evaluate(
    (session) => window.studio.autosaveWorkspace(session),
    original,
  );
  await close();
  // The app owns cached copies, so deleting the original must not affect a
  // healthy tab. Move one cache entry and deny access to a different closed one.
  await rm(source);
  await rename(
    path.join(profile, "media", `${tracks[1].id}.wav`),
    path.join(temporary, "moved-cache.wav"),
  );
  await chmod(path.join(profile, "media", `${tracks[3].id}.wav`), 0o000);
  page = await launch();
  const restored = await page.evaluate(() => window.studio.restoreWorkspace());
  expect(restored?.projects.map((project) => project.id)).toEqual([
    projects[0].id,
  ]);
  expect(restored?.activeProjectId).toBe(projects[0].id);
  expect(restored?.closedProjects?.map((project) => project.id)).toEqual([
    projects[2].id,
  ]);
  expect(restored?.theme).toBe("dark");
  await expect(page.getByText(/workspace could not be restored/i)).toHaveCount(
    0,
  );
  const good = restored!.projects[0];
  const slice = await page.evaluate(
    async (id) => (await window.studio.audioSlice(id, 0, 1, 2.5)).byteLength,
    tracks[0].id,
  );
  expect(slice).toBe(0.4 * 48000 * 2 * 4);
  await app!.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({
      canceled: true,
      filePath: undefined,
    });
  });
  expect(
    await page.evaluate(
      (project) => window.studio.exportAudio(project, "wav"),
      good,
    ),
  ).toBeNull();
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: false,
  });
  const failed = path.join(temporary, "directory.wav");
  await mkdir(failed);
  await app!.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, failed);
  await expect(
    page.evaluate((project) => window.studio.exportAudio(project, "wav"), good),
  ).rejects.toThrow();
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: false,
  });
  await app!.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, exported);
  expect(
    await page.evaluate(
      (project) => window.studio.exportAudio(project, "wav"),
      good,
    ),
  ).toBe(exported);
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: true,
  });
  const ffprobe = await findBinary("ffprobe");
  const probe = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    exported,
  ]);
  expect(Number(probe.stdout.toString())).toBeCloseTo(tracks[0].duration, 2);
  await close();
  page = await launch();
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: true,
  });
  expect(
    (await page.evaluate(() => window.studio.restoreWorkspace()))?.projects,
  ).toHaveLength(1);
  await close();
  const future = JSON.stringify({ version: 99, retainedFutureFixture: true });
  await writeFile(path.join(profile, "workspace-session.json"), future);
  page = await launch();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.studio.restoreWorkspace()))?.projects
          .length || 0,
    )
    .toBe(1);
  const reset = await page.evaluate(() => window.studio.restoreWorkspace());
  expect(reset?.projects).toHaveLength(1);
  expect(reset?.projects[0].tracks).toEqual([]);
  expect(await page.evaluate(() => window.studio.preferences())).toEqual({
    hasExportedMaster: true,
  });
  await expect(page.getByText(/workspace could not be restored/i)).toHaveCount(
    0,
  );
  const recoveries = (await readdir(profile)).filter((filename) =>
    filename.startsWith("workspace-session.recovery-"),
  );
  const originals = await Promise.all(
    recoveries.map((filename) =>
      readFile(path.join(profile, filename), "utf8"),
    ),
  );
  expect(originals).toContain(future);
  console.log(
    JSON.stringify(
      {
        cacheIndependentOfOriginal: true,
        unavailableTabsSkipped: 2,
        validOpenTabs: 1,
        validClosedTabs: 1,
        activeFallback: true,
        speedPreviewBytes: slice,
        cancelledExportRecorded: false,
        failedExportRecorded: false,
        successfulExportRecordedAfterRestart: true,
        futureSchemaResetQuietly: true,
        recoveryCopiesPreserved: recoveries.length,
      },
      null,
      2,
    ),
  );
} finally {
  await close();
  await rm(temporary, { recursive: true, force: true });
}
