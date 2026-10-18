/** Master cuts and playback following, using generated speech and production IPC. */
import { _electron as electron, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendTracks,
  applyAlignment,
  masterClips,
  masterDuration,
  masterTimelineClips,
  masterTimelineDuration,
  newProject,
} from "../src/domain/project";
import { findBinary, runProcess } from "../electron/media";
import type { MixProject, WorkspaceSession } from "../src/shared/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "mixstudio-master-cuts-"),
);
const profile = path.join(temporary, "profile");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const source = path.join(temporary, "Generated demonstration.aiff");
await runProcess("/usr/bin/say", [
  "-v",
  "Samantha",
  "-r",
  "190",
  "-o",
  source,
  "This is generated demonstration speech for an audio editor. We keep the original recording safe while comparing sections. A gray section stays visible but is left out of playback. Restore a section whenever you want. Follow the current sentence while the master plays. Pause, make a small change, and listen again. These examples help verify that every retained sample stays in its original order.",
]);
const ffmpeg = await findBinary("ffmpeg");
const errors: string[] = [];
const launch = () =>
  electron.launch({
    args: [".", `--user-data-dir=${profile}`],
    cwd: root,
    chromiumSandbox: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
let app = await launch();
function current(page: Page) {
  return page.locator(".workspace-page:not([hidden])");
}
async function workspace(page: Page): Promise<WorkspaceSession> {
  const saved = await page.evaluate(() => window.studio.restoreWorkspace());
  if (!saved) throw new Error("The test workspace was not saved.");
  return saved;
}
async function project(page: Page, id: string): Promise<MixProject> {
  const saved = (await workspace(page)).projects.find(
    (entry) => entry.id === id,
  );
  if (!saved) throw new Error("The expected test mix is missing.");
  return saved;
}
async function waitProject(
  page: Page,
  id: string,
  check: (value: MixProject) => boolean,
) {
  await expect.poll(async () => check(await project(page, id))).toBe(true);
  return project(page, id);
}
async function ready(page: Page) {
  await expect(
    current(page).getByRole("button", { name: "Add audio takes", exact: true }),
  ).toBeEnabled();
  await expect(current(page).locator(".progress-banner")).toHaveCount(0);
}
async function editorTop(page: Page) {
  await current(page)
    .locator(".editor-content")
    .evaluate((element) => {
      element.scrollTop = 0;
    });
}
async function seek(page: Page, visual: number, duration: number) {
  await current(page)
    .getByRole("button", { name: "Seek on master track", exact: true })
    .click();
  const bounds = await current(page).locator(".master-clips").boundingBox();
  if (!bounds) throw new Error("No visible master timeline.");
  await page.mouse.click(
    bounds.x + (bounds.width * visual) / duration,
    bounds.y + bounds.height * 0.65,
  );
}
async function drag(
  page: Page,
  from: number,
  to: number,
  duration: number,
  cancel?: "escape" | "pointer",
) {
  await current(page)
    .getByRole("button", { name: "Cut audio on master track", exact: true })
    .click();
  const clips = current(page).locator(".master-clips");
  const bounds = await clips.boundingBox();
  if (!bounds) throw new Error("No visible cut surface.");
  await page.mouse.move(
    bounds.x + (bounds.width * from) / duration,
    bounds.y + bounds.height * 0.65,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + (bounds.width * to) / duration,
    bounds.y + bounds.height * 0.65,
    { steps: 12 },
  );
  await expect(current(page).locator(".master-cut-selection")).toBeVisible();
  const selection = await current(page)
    .locator(".master-cut-selection")
    .evaluate((element) => ({
      start: Number((element as HTMLElement).dataset.start),
      end: Number((element as HTMLElement).dataset.end),
    }));
  if (cancel === "escape") await page.keyboard.press("Escape");
  if (cancel === "pointer")
    await clips.dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      bubbles: true,
    });
  await page.mouse.up();
  await expect(current(page).locator(".master-cut-selection")).toHaveCount(0);
  return selection;
}
async function exportWav(page: Page, filename: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: selected,
    });
  }, filename);
  await current(page)
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: "WAV audio", exact: false })
    .click();
  await ready(page);
  await expect
    .poll(async () => {
      try {
        return (await readFile(filename)).byteLength > 44;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex");
}
async function raw(filename: string) {
  return (
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-i",
      filename,
      "-f",
      "f32le",
      "-",
    ])
  ).stdout;
}

try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  const [track] = await page.evaluate(
    (filename) => window.studio.importPaths([filename]),
    source,
  );
  if (!track) throw new Error("Production audio import returned no source.");
  // Test sections are explicit equal sample partitions of generated speech,
  // not invented transcription or the result of an AI analysis.
  const frames = Math.round(track.duration * 48000);
  const sections = 18;
  const fixture = applyAlignment(
    appendTracks(newProject("Master cut verification"), [track]),
    {
      groups: Array.from({ length: sections }, (_, index) => ({
        text: `Generated demonstration section ${index + 1}.`,
        note: "Prepared verification example.",
        variations: [
          {
            trackId: track.id,
            start: Math.round((frames * index) / sections) / 48000,
            end: Math.round((frames * (index + 1)) / sections) / 48000,
            text: `Generated demonstration section ${index + 1}.`,
          },
        ],
      })),
    },
  );
  await page.evaluate(
    (value) =>
      window.studio.autosaveWorkspace({
        version: 1,
        projects: [value],
        activeProjectId: value.id,
        theme: "light",
        closedProjects: [],
      }),
    fixture,
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1024, 720);
  });
  await expect(current(page).locator(".sentence-row")).toHaveCount(sections);
  const unit = fixture.tracks[0].duration / sections;
  const visualDuration = masterTimelineDuration(fixture);
  await expect(
    current(page).getByRole("button", {
      name: "Seek on master track",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await seek(page, unit * 0.5, visualDuration);
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(0);
  expect(
    Number(
      await current(page)
        .getByRole("slider", { name: "Seek master track", exact: true })
        .inputValue(),
    ),
  ).toBeCloseTo(unit * 0.5, 1);

  // A reversed pointer selection crosses three sentence clips and preserves
  // its full visible span while its output samples are omitted.
  const selection = await drag(page, unit * 2.25, unit * 0.25, visualDuration);
  let edited = await waitProject(
    page,
    fixture.id,
    (value) =>
      value.segments.filter((segment) => segment.excluded).length === 3,
  );
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(3);
  expect(masterTimelineDuration(edited)).toBe(visualDuration);
  const removed = edited.segments
    .filter((segment) => segment.excluded)
    .reduce((total, segment) => total + segment.end - segment.start, 0);
  expect(removed).toBeCloseTo(Math.abs(selection.end - selection.start), 4);
  expect(masterDuration(edited)).toBeCloseTo(visualDuration - removed, 4);
  const editedSnapshot = JSON.stringify(edited.segments);
  await drag(page, unit * 5.2, unit * 5.8, visualDuration, "escape");
  expect(JSON.stringify((await project(page, fixture.id)).segments)).toBe(
    editedSnapshot,
  );
  await drag(page, unit * 5.2, unit * 5.8, visualDuration, "pointer");
  expect(JSON.stringify((await project(page, fixture.id)).segments)).toBe(
    editedSnapshot,
  );

  // Gray audio seeks to the compressed boundary, and the visual cursor jumps
  // to the first retained sample after all consecutive gray clips.
  await seek(page, unit, visualDuration);
  const timeline = masterTimelineClips(edited);
  const firstAfterCut = timeline.find(
    (clip) => !clip.excluded && clip.offset > unit,
  )!;
  await expect
    .poll(async () =>
      Number(
        await current(page).locator(".playhead").getAttribute("data-position"),
      ),
    )
    .toBeCloseTo(firstAfterCut.offset, 3);
  await expect(current(page).locator(".sentence-row.is-playing")).toHaveCount(
    0,
  );

  const gray = current(page).locator(".master-clip.excluded").nth(1);
  const restoredId = await gray.getAttribute("data-segment-id");
  await gray.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Excluded audio", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menu", { name: "Excluded audio", exact: true }),
  ).toHaveCount(0);
  await gray.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Restore audio", exact: true })
    .click();
  await waitProject(page, fixture.id, (value) =>
    value.segments.some(
      (segment) => segment.id === restoredId && !segment.excluded,
    ),
  );
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(2);
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(3);
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(2);
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(0);
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(3);
  edited = await project(page, fixture.id);
  await editorTop(page);
  await page.mouse.move(6, 55);
  await page.screenshot({
    path: path.join(artifacts, "master-cuts-light.png"),
  });

  // Master playback follows late sentences; pausing and previewing do not.
  const lateIndex = 13;
  await seek(page, unit * (lateIndex + 0.15), visualDuration);
  await editorTop(page);
  await current(page)
    .getByRole("button", { name: "Play master", exact: true })
    .click();
  const lateRow = current(page).locator(
    `[data-sentence-drop="${edited.groups[lateIndex].id}"]`,
  );
  await expect(lateRow).toHaveClass(/is-playing/);
  await expect(lateRow).toHaveAttribute("aria-current", "true");
  await expect
    .poll(async () =>
      current(page)
        .locator(".editor-content")
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      lateRow.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const viewport = element
          .closest(".editor-content")!
          .getBoundingClientRect();
        return row.top >= viewport.top - 2 && row.bottom <= viewport.bottom + 2;
      }),
    )
    .toBe(true);
  await current(page)
    .getByRole("button", { name: "Pause master", exact: true })
    .click();
  await expect(current(page).locator(".sentence-row.is-playing")).toHaveCount(
    0,
  );
  await lateRow.getByRole("button", { name: /^Preview / }).click();
  await editorTop(page);
  await page.waitForTimeout(250);
  expect(
    await current(page)
      .locator(".editor-content")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await expect(current(page).locator(".sentence-row.is-playing")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await current(page)
    .getByRole("tab", { name: "Manual edit", exact: true })
    .click();
  await seek(page, unit * (lateIndex + 0.15), visualDuration);
  await editorTop(page);
  await current(page)
    .getByRole("button", { name: "Play master", exact: true })
    .click();
  await page.waitForTimeout(200);
  expect(
    await current(page)
      .locator(".editor-content")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await expect(current(page).locator(".sentence-row.is-playing")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.locator(".sentence-row.is-playing")).toHaveCount(0);
  await page
    .getByRole("tablist", { name: "Projects", exact: true })
    .getByRole("tab", { name: fixture.name, exact: true })
    .click();
  await expect(
    current(page).getByRole("button", { name: "Play master", exact: true }),
  ).toBeVisible();
  await current(page)
    .getByRole("tab", { name: /Sentence choices/ })
    .click();

  // Export is the exact concatenation of retained decoded ranges, without
  // gray samples or additional silence. Portable open and restart keep it.
  const output = path.join(temporary, "master-cut.wav");
  const beforeHash = await exportWav(page, output);
  const exported = await raw(output);
  const preview = await page.evaluate(async (clips) => {
    const chunks: Uint8Array[] = [];
    for (const clip of clips)
      chunks.push(
        new Uint8Array(
          await window.studio.audioSlice(
            clip.trackId,
            clip.start,
            clip.end,
            clip.speed,
          ),
        ),
      );
    const joined = new Uint8Array(
      chunks.reduce((total, bytes) => total + bytes.byteLength, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", joined),
    );
    return {
      sha256: Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      bytes: joined.byteLength,
    };
  }, masterClips(edited));
  expect(createHash("sha256").update(exported).digest("hex")).toBe(
    preview.sha256,
  );
  expect(exported.byteLength).toBe(preview.bytes);
  expect(exported.byteLength / 8).toBe(
    Math.round(masterDuration(edited) * 48000),
  );
  const portable = path.join(temporary, "Master cuts.mixstudio");
  const portableCopy = path.join(temporary, "Master cuts copy.mixstudio");
  await app.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, portable);
  await page.evaluate(
    (value) => window.studio.saveProject(value, true),
    edited,
  );
  await copyFile(portable, portableCopy);
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filename],
    });
  }, portableCopy);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: "open" }),
    ),
  );
  await expect
    .poll(async () => (await workspace(page)).projects.length)
    .toBe(3);
  const reopened = (await workspace(page)).projects.find(
    (entry) => entry.id !== fixture.id && entry.tracks.length,
  )!;
  expect(reopened.tracks[0].id).not.toBe(edited.tracks[0].id);
  expect(
    reopened.segments.map((segment) => ({
      ...segment,
      trackId: "same-source",
    })),
  ).toEqual(
    edited.segments.map((segment) => ({ ...segment, trackId: "same-source" })),
  );
  const reopenedHash = await exportWav(
    page,
    path.join(temporary, "portable-cut.wav"),
  );
  expect(reopenedHash).toBe(beforeHash);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(3);
  expect((await project(page, reopened.id)).segments).toEqual(
    reopened.segments,
  );
  const restartedHash = await exportWav(
    page,
    path.join(temporary, "restart-cut.wav"),
  );
  expect(restartedHash).toBe(beforeHash);

  // Public documentation uses the app's real speech demo and sentence timing,
  // separate from the prepared long-list verification fixture above.
  await current(page)
    .getByRole("button", { name: "Studio settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Quick guide", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Let’s make a mix", exact: true })
    .click();
  await expect(current(page).locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  await ready(page);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 900);
  });
  const demoSession = await workspace(page);
  const demo = demoSession.projects.find(
    (entry) => entry.id === demoSession.activeProjectId,
  )!;
  for (const entry of demoSession.projects.filter(
    (entry) => entry.id !== demo.id,
  ))
    await page
      .getByRole("button", { name: `Close ${entry.name}`, exact: true })
      .first()
      .click();
  const firstDemoClip = masterClips(demo)[0];
  await drag(
    page,
    firstDemoClip.duration * 0.3,
    firstDemoClip.duration * 0.5,
    masterTimelineDuration(demo),
  );
  await expect(current(page).locator(".master-clip.excluded")).toHaveCount(1);
  const notice = current(page).getByRole("button", {
    name: "Dismiss notification",
    exact: true,
  });
  if (await notice.count()) await notice.click();
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Use dark mode", exact: true })
        .click();
    await seek(page, 0, masterTimelineDuration(demo));
    await editorTop(page);
    await current(page)
      .getByRole("button", { name: "Play master", exact: true })
      .click();
    await expect(current(page).locator(".sentence-row.is-playing")).toHaveCount(
      1,
    );
    await expect
      .poll(async () =>
        Number(
          await current(page)
            .getByRole("slider", { name: "Seek master track", exact: true })
            .inputValue(),
        ),
      )
      .toBeGreaterThan(0.15);
    await page.mouse.move(6, 55);
    await page.screenshot({
      path: path.join(artifacts, `master-cuts-demo-${theme}.png`),
    });
    await current(page)
      .getByRole("button", { name: "Pause master", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Use light mode", exact: true })
    .click();
  await current(page)
    .getByRole("tab", { name: "Manual edit", exact: true })
    .click();
  await editorTop(page);
  await page.mouse.move(6, 55);
  await page.screenshot({
    path: path.join(artifacts, "master-cuts-demo-manual.png"),
  });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        generatedSource: track.duration,
        removed,
        outputDuration: masterDuration(edited),
        reverseCrossClipCut: true,
        escapeAndPointerCancellation: true,
        grayRestoreUndoRedo: true,
        grayCursorJump: true,
        masterSentenceFollow: true,
        noFollowForPreviewManualInactive: true,
        portableRestartExactExport: beforeHash,
        screenshot: "artifacts/master-cuts-light.png",
        documentationScreenshots: [
          "master-cuts-demo-light.png",
          "master-cuts-demo-dark.png",
          "master-cuts-demo-manual.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
