/** Native smoke run; test-side dialog stubs exercise the exact production IPC handlers. */
import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";
import { appendSentenceAlternatives } from "../src/domain/project";
import type { MixProject } from "../src/shared/types";

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
  let project: MixProject = {
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
  // A short replacement uses the same trusted import bridge but belongs only
  // to the explicitly targeted sentence, not to a new complete script.
  const snippets = await page.evaluate(
    (file) => window.studio.importPaths([file]),
    fixture,
  );
  project = appendSentenceAlternatives(project, "g", snippets);
  const scopedTrack = project.tracks.find((source) => source.sentenceGroupId);
  const scopedSegment = project.segments.find(
    (segment) => segment.trackId === scopedTrack?.id,
  );
  if (!scopedTrack || !scopedSegment || scopedSegment.enabled)
    throw new Error("A sentence replacement changed the existing selection.");
  // Explicit trims must also survive portable remapping.
  scopedSegment.start = 0.1;
  scopedSegment.end = 1.2;
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
  if (!saved.assets[scopedTrack.id])
    throw new Error("Portable project did not include sentence audio.");
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
  const reopenedSnippet = reopened.tracks.find(
    (source) => source.sentenceGroupId === "g",
  );
  const reopenedPiece = reopened.segments.find(
    (segment) => segment.trackId === reopenedSnippet?.id,
  );
  if (
    !reopenedSnippet ||
    reopenedSnippet.id === scopedTrack.id ||
    !reopenedPiece ||
    reopenedPiece.groupId !== "g" ||
    reopenedPiece.enabled ||
    reopenedPiece.start !== 0.1 ||
    reopenedPiece.end !== 1.2 ||
    reopened.groups.length !== 1
  )
    throw new Error("Portable sentence choice lost its scope or manual edit.");
  // Renderer policy allows opaque sources for media playback, not fetch.
  // Electron's own network stack exercises the real byte-range handler.
  const snippetMedia = await app.evaluate(async ({ net }, source) => {
    const response = await net.fetch(source, {
      headers: { Range: "bytes=0-43" },
    });
    const bytes = await response.arrayBuffer();
    return { status: response.status, size: bytes.byteLength };
  }, reopenedSnippet.mediaUrl);
  if (snippetMedia.status !== 206 || snippetMedia.size !== 44)
    throw new Error(
      "Reopened sentence audio failed the production media protocol.",
    );
  const snippetPlayback = await page.evaluate(async (source) => {
    const audio = new Audio(source);
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener(
        "error",
        () => reject(new Error("Reopened sentence playback source failed")),
        { once: true },
      );
    });
    audio.currentTime = 0.2;
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, 750));
    audio.pause();
    return audio.currentTime;
  }, reopenedSnippet.mediaUrl);
  if (snippetPlayback < 0.3)
    throw new Error("Reopened sentence audio did not play in the renderer.");
  const replacementMix = {
    ...reopened,
    segments: reopened.segments.map((segment) => ({
      ...segment,
      enabled: segment.id === reopenedPiece.id,
    })),
  };
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await page.evaluate(
    (mix) => window.studio.exportAudio(mix, "wav"),
    replacementMix,
  );
  const replacementOutput = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    output,
  ]);
  const replacementDuration = Number(replacementOutput.stdout.toString());
  if (Math.abs(replacementDuration - 1.1) > 0.001)
    throw new Error(
      `Wrong sentence replacement duration: ${replacementDuration}`,
    );
  const scopedAnalysis = await page.evaluate(async (mix) => {
    const tracks = mix.tracks.filter((source) => !!source.sentenceGroupId);
    const trackIds = new Set(tracks.map((source) => source.id));
    const segments = mix.segments.filter((segment) =>
      trackIds.has(segment.trackId),
    );
    const segmentIds = new Set(segments.map((segment) => segment.id));
    const onlyReplacement = {
      ...mix,
      tracks,
      segments,
      groups: mix.groups.map((group) => ({
        ...group,
        segmentIds: group.segmentIds.filter((id) => segmentIds.has(id)),
      })),
    };
    try {
      await window.studio.analyze(onlyReplacement);
      return "unexpected success";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, replacementMix);
  if (!scopedAnalysis.includes("Add a complete audio take"))
    throw new Error(
      `A sentence-only source entered AI analysis: ${scopedAnalysis}`,
    );
  await page.screenshot({ path: path.join(artifacts, "native-smoke.png") });
  console.log(
    JSON.stringify(
      {
        imported: track.duration,
        playback,
        exported: duration,
        portable: true,
        sentenceScope: true,
        replacementExport: replacementDuration,
        sentenceOnlyAnalysisBlocked: true,
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
