/** Production Electron flow with generated tones and speech; only native picker answers are replaced. */
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";
import type { WorkspaceSession } from "../src/shared/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-music-"));
const profile = path.join(temporary, "profile");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const musicFile = path.join(temporary, "Demonstration music.wav");
const effectFile = path.join(temporary, "Demonstration effect.wav");
const ffmpeg = await findBinary("ffmpeg");
for (const [file, filter] of [
  [musicFile, "sine=frequency=220:duration=12"],
  [effectFile, "sine=frequency=880:duration=2"],
])
  await runProcess(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    filter,
    "-ar",
    "48000",
    "-ac",
    "2",
    file,
  ]);
const launch = () =>
  electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: root,
    chromiumSandbox: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
let app = await launch();
const errors: string[] = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Quick guide", exact: true }).click();
  await page
    .getByRole("button", { name: "Let’s make a mix", exact: true })
    .click();
  await expect(page.locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  await expect(page.getByRole("tab", { name: "Manual edit" })).toHaveCount(0);
  const snapshot = async () =>
    JSON.parse(
      await readFile(path.join(profile, "workspace-session.json"), "utf8"),
    ) as WorkspaceSession;
  const importFile = async (file: string, kind: "Music" | "Sound effect") => {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await page.getByRole("button", { name: "Add audio", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "What are we listening to?",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Play imported audio", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Pause imported audio", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Import preview speed" })
      .selectOption("2");
    await dialog.getByRole("button", { name: "Forward 5 seconds" }).click();
    await dialog.getByRole("button", { name: "Back 5 seconds" }).click();
    await dialog.getByRole("radio", { name: new RegExp(`^${kind}`) }).click();
    await dialog
      .getByRole("button", { name: `Add ${kind.toLowerCase()}`, exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add audio", exact: true }),
    ).toBeEnabled();
  };
  await importFile(musicFile, "Music");
  await expect(page.locator(".music-lane")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Add audio to Music 1", exact: true })
    .click();
  let arranger = page.getByRole("dialog", { name: "Music 1", exact: true });
  await arranger
    .getByRole("button", {
      name: "Add Demonstration music.wav to Music 1",
      exact: true,
    })
    .click();
  await expect(arranger.locator(".music-clip")).toHaveCount(1);
  await arranger.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".music-lane-music .music-clip")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add audio to Music 1", exact: true })
    .click();
  arranger = page.getByRole("dialog", { name: "Music 1", exact: true });
  await arranger
    .locator(".music-library-source")
    .dragTo(arranger.locator(".music-staging-lane"), {
      targetPosition: { x: 5, y: 45 },
    });
  await expect(arranger.locator(".music-clip")).toHaveCount(1);
  await arranger
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  await expect(page.locator(".music-lane-music .music-clip")).toHaveCount(1);
  await importFile(effectFile, "Sound effect");
  await page
    .getByRole("button", { name: "Add audio to Soundtrack 1", exact: true })
    .click();
  arranger = page.getByRole("dialog", { name: "Soundtrack 1", exact: true });
  await arranger
    .getByRole("button", {
      name: "Add Demonstration effect.wav to Soundtrack 1",
      exact: true,
    })
    .click();
  await arranger
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  await page
    .locator(".music-lane-music .music-clip")
    .click({ position: { x: 20, y: 40 } });
  const inspector = page.getByRole("complementary", {
    name: "Selected audio settings",
  });
  const seek = page.getByRole("slider", { name: "Seek master track" });
  await seek.fill("3");
  await inspector
    .getByRole("button", { name: "Keyframe at playhead", exact: true })
    .click();
  await expect(page.locator(".music-keyframe")).toHaveCount(1);
  await inspector
    .getByRole("combobox", { name: "Keyframe section" })
    .selectOption({ index: 1 });
  await inspector
    .getByRole("spinbutton", { name: "Playback speed value", exact: true })
    .fill("1.37");
  await inspector
    .getByRole("spinbutton", { name: "Playback speed value", exact: true })
    .press("Enter");
  await inspector
    .getByRole("spinbutton", { name: "Volume value", exact: true })
    .fill("32");
  await inspector
    .getByRole("spinbutton", { name: "Volume value", exact: true })
    .press("Enter");
  await inspector
    .getByRole("spinbutton", { name: "Fade in duration value", exact: true })
    .fill("0.5");
  await inspector
    .getByRole("spinbutton", { name: "Fade in duration value", exact: true })
    .press("Enter");
  await inspector
    .getByRole("button", { name: "Fade in custom curve", exact: true })
    .click();
  await inspector
    .getByRole("spinbutton", { name: "Fade in curve shape value", exact: true })
    .fill("2.5");
  await inspector
    .getByRole("spinbutton", { name: "Fade in curve shape value", exact: true })
    .press("Enter");
  await inspector
    .getByRole("button", { name: "Close audio settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByRole("button", { name: /^Music track/ }).click();
  await expect(page.locator(".music-lane")).toHaveCount(4);
  await page
    .locator(".music-lane-name")
    .filter({ hasText: "Music 2" })
    .dragTo(
      page.locator(".music-lane-header").filter({ hasText: "Voiceover" }),
    );
  await expect(page.locator(".music-lane-name").first()).toHaveText(/Music 2/);
  await page
    .getByRole("button", { name: "Delete Music 2", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete Music 2?", exact: true })
    .getByRole("button", { name: "Keep track", exact: true })
    .click();
  await expect(page.locator(".music-lane")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Delete Music 2", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete Music 2?", exact: true })
    .getByRole("button", { name: "Delete track", exact: true })
    .click();
  await expect(page.locator(".music-lane")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Zoom in mix tracks", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fit all mix tracks", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Return to start", exact: true })
    .click();
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await expect
    .poll(async () => Number(await seek.inputValue()), { timeout: 30_000 })
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  const output = path.join(temporary, "mixed.wav");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await page
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await page.getByRole("button", { name: /WAV audio/ }).click();
  await expect(page.getByText("Exported WAV.", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const probe = await runProcess(await findBinary("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    output,
  ]);
  const exportedDuration = Number(
    JSON.parse(probe.stdout.toString()).format.duration,
  );
  if (!(exportedDuration > 5)) throw new Error("Mixed export was empty.");
  await expect
    .poll(
      async () => (await snapshot()).projects[0].soundMix?.placements.length,
    )
    .toBe(2);
  const saved = (await snapshot()).projects[0];
  if (saved.soundMix?.placements[0].keyframes[0].settings.speed !== 1.37)
    throw new Error("Keyframe section did not persist.");
  const portable = path.join(temporary, "Soundtrack.mixstudio");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, portable);
  await page.evaluate(
    (project) => window.studio.saveProject(project, true),
    saved,
  );
  const portableCopy = path.join(temporary, "Copied soundtrack.mixstudio");
  await copyFile(portable, portableCopy);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, portableCopy);
  const reopened = await page.evaluate(
    (id) => window.studio.openProject(id),
    saved.id,
  );
  if (
    !reopened?.soundMix ||
    reopened.soundMix.placements.length !== 2 ||
    reopened.soundMix.placements[0].trackId ===
      saved.soundMix!.placements[0].trackId ||
    reopened.soundMix.placements[0].keyframes[0].settings.speed !== 1.37
  )
    throw new Error("Portable mix lost its remapped sources or keyframes.");
  const reopenedMusic = reopened.tracks.find(
    (track) => track.role === "music",
  )!;
  const protocol = await app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url, { headers: { Range: "bytes=0-63" } });
    return {
      status: response.status,
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, reopenedMusic.mediaUrl);
  if (protocol.status !== 206 || protocol.bytes !== 64)
    throw new Error("Portable music failed the production media protocol.");
  // Music remains playable/exportable when every narration sentence is skipped.
  await page.getByRole("tab", { name: /^Sentence choices/ }).click();
  for (let sentence = 1; sentence <= 4; sentence++)
    await page
      .getByRole("button", { name: `Skip sentence ${sentence}`, exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Play master", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Return to start", exact: true })
    .click();
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await expect
    .poll(async () => Number(await seek.inputValue()), { timeout: 30_000 })
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  const layersOnly = path.join(temporary, "layers-only.wav");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, layersOnly);
  await page
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await page.getByRole("button", { name: /WAV audio/ }).click();
  await expect(page.getByText("Exported WAV.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  for (let edit = 0; edit < 4; edit++)
    await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  const notice = page.getByRole("button", { name: "Dismiss notification" });
  if (await notice.count()) await notice.click();
  await page
    .getByRole("button", { name: "Return to start", exact: true })
    .click();
  await page.screenshot({ path: path.join(artifacts, "music-workspace.png") });
  await copyFile(
    path.join(artifacts, "music-workspace.png"),
    path.join(root, "docs/screenshots/music-workspace.png"),
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1024, 720),
  );
  await page
    .locator(".music-lane-music .music-clip")
    .click({ position: { x: 20, y: 40 } });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow)
    throw new Error("Minimum-size music workspace overflows the window.");
  await page.screenshot({ path: path.join(artifacts, "music-responsive.png") });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator(".sentence-row")).toHaveCount(4);
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  await expect(page.locator(".music-lane-music .music-clip")).toHaveCount(1);
  await expect(page.locator(".music-keyframe")).toHaveCount(1);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        classifiedImports: 2,
        audition: true,
        arrangerCancel: true,
        dragPlacement: true,
        trackReorder: true,
        confirmedDelete: true,
        sectionSpeed: 1.37,
        fadeCurve: "custom",
        masterPlayback: true,
        layersOnlyPlaybackAndExport: true,
        portableMixRemapping: true,
        exportedDuration,
        restart: true,
        minimumWindow: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: path.join(artifacts, "music-failure.png") });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
