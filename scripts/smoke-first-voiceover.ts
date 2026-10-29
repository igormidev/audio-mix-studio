/** Real first-source speech verification. Only native picker answers are substituted. */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";
import type { WorkspaceSession } from "../src/shared/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "mixstudio-first-voiceover-"),
);
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const narration = path.join(temporary, "Generated narration.aiff");
const instrumental = path.join(temporary, "Generated non-speech tone.wav");
const timeout = 180_000;
const errors: string[] = [];

await runProcess("/usr/bin/say", [
  "-v",
  "Samantha",
  "-r",
  "155",
  "-o",
  narration,
  "This is a narration recording. Every sentence belongs in the voiceover. We compare the delivery and choose the parts that tell our story clearly.",
]);
await runProcess(await findBinary("ffmpeg"), [
  "-hide_banner",
  "-loglevel",
  "error",
  "-nostdin",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=5",
  "-ac",
  "2",
  "-c:a",
  "pcm_s24le",
  instrumental,
]);
const app = await electron.launch({
  args: [".", `--user-data-dir=${path.join(temporary, "profile")}`],
  cwd: root,
  chromiumSandbox: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});

async function workspace(page: Page): Promise<WorkspaceSession> {
  const result = await page.evaluate(() => window.studio.restoreWorkspace());
  if (!result) throw new Error("The initial workspace is missing.");
  return result;
}
async function importSource(page: Page, filename: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, filename);
  await page
    .getByRole("button", { name: "Import your audio", exact: true })
    .click();
}

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "Import your audio", exact: true }),
  ).toBeEnabled();
  const dependencies = await page.evaluate(() => window.studio.dependencies());
  if (
    !dependencies.ffmpeg.available ||
    !dependencies.whisperx.available ||
    !dependencies.codex.available ||
    !dependencies.models.some(
      (model) => model.id === "large-v3-turbo" && model.downloaded,
    )
  )
    throw new Error(
      "Real first-source verification requires the installed FFmpeg, WhisperX, Codex login, and default model.",
    );

  await importSource(page, instrumental);
  await expect(page.locator(".error-banner")).toBeVisible({ timeout });
  const rejection = await page.locator(".error-banner").innerText();
  expect(rejection).toMatch(/no speech|no spoken|transcript|speech/i);
  await expect(page.locator(".progress-banner")).toHaveCount(0, { timeout });
  await expect(page.locator(".take,.sentence-row")).toHaveCount(0);
  await expect(page.locator(".import-kind-modal")).toHaveCount(0);
  const rejected = await workspace(page);
  expect(rejected.projects).toHaveLength(1);
  expect(rejected.projects[0].tracks).toHaveLength(0);
  expect(rejected.projects[0].groups).toHaveLength(0);
  expect(rejected.projects[0].segments).toHaveLength(0);

  await page.evaluate(() => {
    const scope = window as typeof window & {
      __firstVoiceoverProgress?: {
        phase: string;
        adoptedSources: number;
        adoptedSentences: number;
      }[];
    };
    scope.__firstVoiceoverProgress = [];
    window.studio.onProgress((progress) => {
      if (progress)
        scope.__firstVoiceoverProgress!.push({
          phase: progress.phase,
          adoptedSources: document.querySelectorAll(".take").length,
          adoptedSentences: document.querySelectorAll(".sentence-row").length,
        });
    });
  });
  await importSource(page, narration);
  await expect(page.locator(".sentence-row").first()).toBeVisible({ timeout });
  await expect(page.locator(".progress-banner")).toHaveCount(0, { timeout });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(page.locator(".take")).toHaveCount(1);
  await expect(page.locator(".import-kind-modal")).toHaveCount(0);
  const accepted = (await workspace(page)).projects[0];
  expect(accepted.id).toBe(rejected.projects[0].id);
  expect(accepted.tracks).toHaveLength(1);
  expect(accepted.tracks[0].role).toBe("voiceover");
  const transcript = accepted.tracks[0].transcript;
  expect(transcript?.model).toBe("large-v3-turbo");
  expect(transcript?.segments.length).toBeGreaterThan(0);
  expect(transcript?.segments.map((segment) => segment.text).join(" ")).toMatch(
    /narration|recording|sentence|voiceover/i,
  );
  expect(accepted.groups.length).toBeGreaterThan(0);
  expect(accepted.groups.every((group) => group.segmentIds.length > 0)).toBe(
    true,
  );
  const ordered = [...accepted.segments].sort((a, b) => a.start - b.start);
  expect(ordered[0].start).toBe(0);
  expect(Math.round(ordered.at(-1)!.end * 48000)).toBe(
    Math.round(accepted.tracks[0].duration * 48000),
  );
  for (let index = 1; index < ordered.length; index++)
    expect(ordered[index].start).toBe(ordered[index - 1].end);
  const progress = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __firstVoiceoverProgress?: {
            phase: string;
            adoptedSources: number;
            adoptedSentences: number;
          }[];
        }
      ).__firstVoiceoverProgress ?? [],
  );
  expect(progress.some((event) => event.phase === "transcribing")).toBe(true);
  expect(progress.some((event) => event.phase === "grouping")).toBe(true);
  expect(
    progress.every(
      (event) => event.adoptedSources === 0 && event.adoptedSentences === 0,
    ),
  ).toBe(true);

  const media = await app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url, { headers: { Range: "bytes=0-63" } });
    return {
      status: response.status,
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, accepted.tracks[0].mediaUrl);
  expect(media).toEqual({ status: 206, bytes: 64 });
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Seek master track", exact: true }),
  ).not.toHaveValue("0", { timeout: 30_000 });
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, "first-voiceover-verified.png"),
  });
  console.log(
    JSON.stringify(
      {
        rejectedNonSpeechWithoutAdoption: true,
        verifiedRealWhisperXAndCodexBeforeAdoption: true,
        firstImportHasNoClassificationDialog: true,
        completeSourcePartition: true,
        productionMediaProtocol: media,
        realMasterPlayback: true,
        sourceDuration: accepted.tracks[0].duration,
        sentenceCount: accepted.groups.length,
        phases: [...new Set(progress.map((event) => event.phase))],
      },
      null,
      2,
    ),
  );
} catch (error) {
  const page = await app.firstWindow();
  console.error(
    "First-source diagnostics:",
    await page
      .locator(".error-banner,.progress-banner,.workspace-save-error")
      .allTextContents(),
  );
  await page.screenshot({
    path: path.join(artifacts, "first-voiceover-failure.png"),
  });
  throw error;
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
