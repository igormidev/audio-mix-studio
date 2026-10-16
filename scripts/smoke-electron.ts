/** Native smoke run; test-side dialog stubs exercise the exact production IPC handlers. */
import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-live-"));
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const fixture = path.join(temporary, "actual-input.wav");
const output = path.join(temporary, "master.wav");
const projectFile = path.join(temporary, "Portable..v1.mixstudio");
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
  fixture,
]);
const app = await electron.launch({
  args: [".", `--user-data-dir=${path.join(temporary, "profile")}`],
  cwd: root,
  chromiumSandbox: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.studio);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, fixture);
  const track = await page
    .evaluate(() => window.studio.importAudio())
    .then((tracks) => tracks[0]);
  if (!track || track.duration < 1)
    throw new Error("Native import did not prepare the audio.");
  const playback = await page.evaluate(async (source) => {
    const audio = new Audio(source);
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener(
        "error",
        () => reject(new Error("Playback source failed")),
        { once: true },
      );
    });
    audio.currentTime = 0.4;
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, 750));
    audio.pause();
    return { duration: audio.duration, currentTime: audio.currentTime };
  }, track.mediaUrl);
  if (playback.currentTime < 0.5)
    throw new Error(
      `Native audio did not advance: ${JSON.stringify(playback)}`,
    );
  const project = {
    version: 1 as const,
    id: "native-smoke-project",
    name: "Native smoke",
    tracks: [track],
    groups: [{ id: "g", text: "Selected audio", note: "", segmentIds: ["s"] }],
    segments: [
      {
        id: "s",
        groupId: "g",
        trackId: track.id,
        start: 0.2,
        end: 1.1,
        text: "Selected audio",
        enabled: true,
      },
    ],
    model: "large-v3-turbo" as const,
    joinFadeMs: 8,
    updatedAt: new Date().toISOString(),
  };
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  const exported = await page.evaluate(
    (project) => window.studio.exportAudio(project, "wav"),
    project,
  );
  if (exported !== output) throw new Error("Native export returned no file.");
  const ffprobe = await findBinary("ffprobe");
  const result = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    output,
  ]);
  const duration = Number(result.stdout.toString());
  if (Math.abs(duration - 0.9) > 0.01)
    throw new Error(`Wrong export duration: ${duration}`);
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, projectFile);
  await page.evaluate(
    (project) => window.studio.saveProject(project, true),
    project,
  );
  const saved = JSON.parse(await readFile(projectFile, "utf8"));
  if (!saved.assets[track.id])
    throw new Error("Portable project did not include source assets.");
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, projectFile);
  const reopened = await page.evaluate(() => window.studio.openProject());
  if (reopened?.segments[0].start !== 0.2 || reopened.tracks[0].id === track.id)
    throw new Error(
      "Portable project did not reopen into authorized cached audio.",
    );
  await page.screenshot({ path: path.join(artifacts, "native-smoke.png") });
  console.log(
    JSON.stringify(
      {
        imported: track.duration,
        playback,
        exported: duration,
        portable: true,
        screenshot: "artifacts/native-smoke.png",
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
