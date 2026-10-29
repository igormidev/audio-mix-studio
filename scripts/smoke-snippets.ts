/** Sentence-scoped import regressions with generated audio and production IPC. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { masterClips, masterDuration } from "../src/domain/project";
import type { MixProject, WorkspaceSession } from "../src/shared/types";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-snippets-"));
const profile = path.join(temporary, "profile");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const fixtures = [
  { name: "Replacement sentence.wav", frequency: 880, duration: 1.25 },
  { name: "Alternative sentence.wav", frequency: 660, duration: 0.875 },
  { name: "Shorter sentence.wav", frequency: 550, duration: 0.625 },
];
const files = fixtures.map((fixture) => path.join(temporary, fixture.name));
const invalid = path.join(temporary, "Not audio.wav");
const ffmpeg = await findBinary("ffmpeg");
for (const [index, fixture] of fixtures.entries())
  await runProcess(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${fixture.frequency}:duration=${fixture.duration}`,
    "-ar",
    "48000",
    "-ac",
    "2",
    files[index],
  ]);
await writeFile(
  invalid,
  "This deliberately invalid file is not an audio stream.",
);
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
function sentence(page: Page, groupId: string) {
  return current(page).locator(`[data-sentence-drop="${groupId}"]`);
}
function tab(page: Page, name: string) {
  return page
    .getByRole("tablist", { name: "Projects", exact: true })
    .getByRole("tab", { name, exact: true });
}
async function workspace(page: Page): Promise<WorkspaceSession> {
  const result = await page.evaluate(() => window.studio.restoreWorkspace());
  if (!result) throw new Error("The test workspace has not been saved.");
  return result;
}
async function project(page: Page, id: string): Promise<MixProject> {
  const result = (await workspace(page)).projects.find(
    (entry) => entry.id === id,
  );
  if (!result) throw new Error("The expected project is missing.");
  return result;
}
async function waitProject(
  page: Page,
  id: string,
  check: (value: MixProject) => boolean,
) {
  await expect.poll(async () => check(await project(page, id))).toBe(true);
  return project(page, id);
}
async function rename(page: Page, name: string) {
  await page.locator('.studio-tab-label[aria-selected="true"]').dblclick();
  const input = page.getByRole("textbox", { name: "Rename tab", exact: true });
  await input.fill(name);
  await input.press("Enter");
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () =>
      (await workspace(page)).projects.some((p) => p.name === name),
    )
    .toBe(true);
  return (await workspace(page)).projects.find((entry) => entry.name === name)!;
}
async function picker(
  application: ElectronApplication,
  paths: string[] | null,
) {
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () =>
      selected
        ? { canceled: false, filePaths: selected }
        : { canceled: true, filePaths: [] };
  }, paths);
}
async function holdPicker(application: ElectronApplication) {
  await application.evaluate(({ dialog }) => {
    const scope = globalThis as typeof globalThis & {
      __snippetPicker?: (result: {
        canceled: boolean;
        filePaths: string[];
      }) => void;
    };
    dialog.showOpenDialog = () =>
      new Promise((resolve) => {
        scope.__snippetPicker = resolve;
      });
  });
}
async function releasePicker(
  application: ElectronApplication,
  paths: string[],
) {
  await application.evaluate((_electron, selected) => {
    const scope = globalThis as typeof globalThis & {
      __snippetPicker?: (result: {
        canceled: boolean;
        filePaths: string[];
      }) => void;
    };
    if (!scope.__snippetPicker) throw new Error("No native picker is waiting.");
    scope.__snippetPicker({ canceled: false, filePaths: selected });
    delete scope.__snippetPicker;
  }, paths);
}
async function acceptVoiceover(page: Page, count = 1) {
  for (let index = 0; index < count; index++) {
    const dialog = current(page).getByRole("dialog", {
      name: "What are we listening to?",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Add voiceover", exact: true })
      .click();
    if (index === count - 1) await expect(dialog).toHaveCount(0);
  }
}
async function ready(page: Page) {
  await expect(current(page).locator(".progress-banner")).toHaveCount(0);
  await expect(
    current(page).getByRole("button", { name: "Add audio", exact: true }),
  ).toBeEnabled();
}
async function dismiss(page: Page) {
  for (const name of ["Dismiss error", "Dismiss notification"]) {
    const button = current(page).getByRole("button", { name, exact: true });
    if (await button.count()) await button.click();
  }
}
async function dragFile(
  page: Page,
  target: Locator,
  phase: "dragover" | "drop" | "dragleave",
  paths = [files[0]],
) {
  await page.evaluate(() => {
    if (document.querySelector("#__snippet_drop_files")) return;
    const input = document.createElement("input");
    input.id = "__snippet_drop_files";
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    document.body.append(input);
  });
  await page.locator("#__snippet_drop_files").setInputFiles(paths);
  const actualPaths = await page
    .locator("#__snippet_drop_files")
    .evaluate((input) =>
      Array.from((input as HTMLInputElement).files ?? []).map((file) =>
        window.studio.pathForFile(file),
      ),
    );
  expect(actualPaths).toEqual(paths);
  await target.evaluate((element, type) => {
    const input = document.querySelector<HTMLInputElement>(
      "#__snippet_drop_files",
    )!;
    const transfer = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) transfer.items.add(file);
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        relatedTarget: type === "dragleave" ? document.body : null,
      }),
    );
  }, phase);
}
async function unchanged(page: Page, before: MixProject) {
  // Wait through renderer adoption/autosave rather than checking the old snapshot immediately.
  await page.waitForTimeout(200);
  const after = await project(page, before.id);
  expect(after.tracks).toEqual(before.tracks);
  expect(after.groups).toEqual(before.groups);
  expect(after.segments).toEqual(before.segments);
}
function assertScoped(value: MixProject, trackId: string, groupId: string) {
  const track = value.tracks.find((entry) => entry.id === trackId)!;
  expect(track.sentenceGroupId).toBe(groupId);
  const segments = value.segments.filter((entry) => entry.trackId === trackId);
  expect(segments).toHaveLength(1);
  expect(segments[0]).toMatchObject({ groupId, start: 0, end: track.duration });
  expect(
    value.groups.find((entry) => entry.id === groupId)!.segmentIds,
  ).toContain(segments[0].id);
}
async function exportWav(
  application: ElectronApplication,
  page: Page,
  filename: string,
) {
  await application.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, filename);
  await current(page)
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: /WAV audio/ })
    .click();
  await expect(
    current(page).getByText("Exported WAV.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const probe = await runProcess(await findBinary("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filename,
  ]);
  return {
    duration: Number(probe.stdout.toString()),
    sha256: createHash("sha256")
      .update(await readFile(filename))
      .digest("hex"),
  };
}
async function captureDemo(application: ElectronApplication, page: Page) {
  for (const [width, height] of [
    [1024, 720],
    [1440, 900],
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(
          size.width,
          size.height,
        ),
      { width, height },
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      )
      .toEqual({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const button = current(page).getByRole("button", {
      name: "Add audio to sentence 1",
      exact: true,
    });
    await button.click({ trial: true });
    const box = await button.boundingBox();
    expect(box && box.x + box.width <= width).toBe(true);
  }
  for (const theme of ["light", "dark"] as const) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", {
          name: theme === "light" ? "Use light mode" : "Use dark mode",
          exact: true,
        })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.mouse.move(1435, 895);
    await page.screenshot({
      path: path.join(artifacts, `snippet-demo-${theme}-choices.png`),
    });
  }
  await page
    .getByRole("button", { name: "Use light mode", exact: true })
    .click();
  await current(page)
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  await page.screenshot({
    path: path.join(artifacts, "snippet-demo-light-music.png"),
  });
  await current(page)
    .getByRole("tab", { name: /^Sentence choices/ })
    .click();
}

try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New tab", exact: true }),
  ).toBeEnabled();
  await current(page)
    .getByRole("button", { name: "Quick guide", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Let’s make a mix", exact: true })
    .click();
  await expect(current(page).locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  const initial = await rename(page, "Sentence replacements");
  await dismiss(page);
  await captureDemo(app, page);
  const target = initial.groups[1];
  const row = () => sentence(page, target.id);
  const add = () =>
    row().getByRole("button", { name: "Add audio to sentence 2", exact: true });
  await expect(add()).toBeVisible();

  // Once a mix has takes, toolbar/search/blank choice space cannot import full recordings.
  for (const area of [
    current(page).locator(".editor-nav"),
    current(page).locator(".list-toolbar"),
    current(page).getByRole("textbox", {
      name: "Find a sentence",
      exact: true,
    }),
  ]) {
    await dragFile(page, area, "dragover");
    await expect(
      current(page).locator(
        ".drop-overlay,.take-drop-overlay,.sentence-drop-overlay",
      ),
    ).toHaveCount(0);
    await dragFile(page, area, "drop");
    await unchanged(page, initial);
  }
  const search = current(page).getByRole("textbox", {
    name: "Find a sentence",
    exact: true,
  });
  await search.fill("A sentence that does not exist in the demonstration");
  await expect(current(page).locator(".sentence-row")).toHaveCount(0);
  await dragFile(page, current(page).locator(".editor-content"), "dragover");
  await expect(
    current(page).locator(
      ".drop-overlay,.take-drop-overlay,.sentence-drop-overlay",
    ),
  ).toHaveCount(0);
  await dragFile(page, current(page).locator(".editor-content"), "drop");
  await unchanged(page, initial);
  await search.fill("");

  await picker(app, null);
  await add().click();
  await ready(page);
  await unchanged(page, initial);
  await picker(app, [invalid]);
  await add().click();
  await expect(current(page).getByRole("alert")).toBeVisible();
  await ready(page);
  await unchanged(page, initial);
  await dismiss(page);

  // Native picker creates an unselected full-source variation in only the requested sentence.
  await picker(app, [files[0]]);
  await add().click();
  await acceptVoiceover(page);
  let withSnippet = await waitProject(
    page,
    initial.id,
    (p) => p.tracks.length === initial.tracks.length + 1,
  );
  const snippet = withSnippet.tracks.at(-1)!;
  assertScoped(withSnippet, snippet.id, target.id);
  expect(withSnippet.groups.map((group) => group.id)).toEqual(
    initial.groups.map((group) => group.id),
  );
  expect(
    withSnippet.segments.filter((entry) => entry.trackId !== snippet.id),
  ).toEqual(initial.segments);
  expect(
    withSnippet.segments.find((entry) => entry.trackId === snippet.id)!.enabled,
  ).toBe(false);
  expect(masterClips(withSnippet)).toEqual(masterClips(initial));
  for (const group of initial.groups) {
    const before = initial.segments.filter(
      (entry) => entry.groupId === group.id,
    ).length;
    await expect(sentence(page, group.id).locator(".variation")).toHaveCount(
      before + Number(group.id === target.id),
    );
  }
  await expect(
    current(page).getByRole("button", {
      name: "Regroup sentences",
      exact: true,
    }),
  ).toBeVisible();
  const snippetCard = row().locator(".variation").last();
  await page.evaluate(() => {
    const scope = window as typeof window & { __snippetAudioStarts?: number[] };
    scope.__snippetAudioStarts = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      scope.__snippetAudioStarts!.push(this.buffer?.duration ?? 0);
      return Reflect.apply(original, this, args);
    };
  });
  await snippetCard.locator(".preview-button").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __snippetAudioStarts?: number[] })
            .__snippetAudioStarts?.[0] ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await snippetCard.locator(".preview-button").click();
  expect(masterClips(await project(page, initial.id))).toEqual(
    masterClips(initial),
  );
  await snippetCard.locator(".variation-select").click();
  withSnippet = await waitProject(page, initial.id, (p) =>
    p.segments.some((entry) => entry.trackId === snippet.id && entry.enabled),
  );
  expect(
    masterClips(withSnippet)
      .filter((entry) => entry.groupId === target.id)
      .map((entry) => entry.trackId),
  ).toEqual([snippet.id]);
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await waitProject(
    page,
    initial.id,
    (p) =>
      p.tracks.length === initial.tracks.length + 1 &&
      !p.segments.some(
        (entry) => entry.trackId === snippet.id && entry.enabled,
      ),
  );
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await waitProject(
    page,
    initial.id,
    (p) => p.tracks.length === initial.tracks.length,
  );
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await waitProject(page, initial.id, (p) =>
    p.segments.some((entry) => entry.trackId === snippet.id && entry.enabled),
  );

  // The hover target moves between sentences without ever presenting the full-import overlay.
  const firstGroup = initial.groups[0];
  await dragFile(
    page,
    sentence(page, firstGroup.id),
    "dragover",
    files.slice(1),
  );
  await expect(
    sentence(page, firstGroup.id).locator(".sentence-drop-overlay"),
  ).toBeVisible();
  await expect(current(page).locator(".sentence-drop-overlay")).toHaveCount(1);
  await expect(
    current(page).locator(".drop-overlay,.take-drop-overlay"),
  ).toHaveCount(0);
  await dragFile(page, row(), "dragover", files.slice(1));
  await expect(row().locator(".sentence-drop-overlay")).toBeVisible();
  await expect(
    sentence(page, firstGroup.id).locator(".sentence-drop-overlay"),
  ).toHaveCount(0);
  await dragFile(
    page,
    sentence(page, firstGroup.id),
    "dragover",
    files.slice(1),
  );
  await dragFile(page, sentence(page, firstGroup.id), "drop", files.slice(1));
  await acceptVoiceover(page, 2);
  const afterDrop = await waitProject(
    page,
    initial.id,
    (p) => p.tracks.length === initial.tracks.length + 3,
  );
  for (const track of afterDrop.tracks.slice(-2)) {
    assertScoped(afterDrop, track.id, firstGroup.id);
    expect(
      afterDrop.segments.find((entry) => entry.trackId === track.id)!.enabled,
    ).toBe(false);
  }
  expect(masterClips(afterDrop)).toEqual(masterClips(withSnippet));
  await expect(
    current(page).locator(
      ".sentence-drop-overlay,.drop-overlay,.take-drop-overlay",
    ),
  ).toHaveCount(0);
  await dismiss(page);
  if ((await page.locator("html").getAttribute("data-theme")) !== "light")
    await page
      .getByRole("button", { name: "Use light mode", exact: true })
      .click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await current(page)
    .locator(".editor-content")
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  await page.screenshot({
    path: path.join(artifacts, "sentence-snippets.png"),
  });

  // Sidebar, master, and the music workspace still accept complete takes.
  for (const region of ["sidebar", "master", "music"] as const) {
    if (region === "music")
      await current(page)
        .getByRole("tab", { name: "Music & Sound Track", exact: true })
        .click();
    const area = current(page).locator(`[data-full-take-drop="${region}"]`);
    await expect(area).toHaveAttribute("data-full-take-drop", region);
    const before = await project(page, initial.id);
    await dragFile(page, area, "dragover", [files[2]]);
    await expect(
      current(page).locator(".drop-overlay,.take-drop-overlay"),
    ).toBeVisible();
    await expect(current(page).locator(".sentence-drop-overlay")).toHaveCount(
      0,
    );
    await dragFile(page, area, "drop", [files[2]]);
    await acceptVoiceover(page);
    const after = await waitProject(
      page,
      initial.id,
      (p) => p.tracks.length === before.tracks.length + 1,
    );
    const imported = after.tracks.at(-1)!;
    expect(imported.sentenceGroupId).toBeUndefined();
    expect(after.groups.length).toBe(before.groups.length + 1);
    expect(
      after.segments.find((entry) => entry.trackId === imported.id),
    ).toMatchObject({ start: 0, end: imported.duration, enabled: true });
    await ready(page);
    await dismiss(page);
  }
  await current(page)
    .getByRole("tab", { name: /^Sentence choices/ })
    .click();

  // An open native picker keeps ownership even when another project becomes active.
  const beforeBackground = await project(page, initial.id);
  await holdPicker(app);
  await add().click();
  await expect(
    page.getByRole("button", {
      name: "Close Sentence replacements",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const scratch = await rename(page, "Empty drop");
  await releasePicker(app, [files[2]]);
  // Classification belongs to the origin tab and waits until that tab is active.
  await unchanged(page, beforeBackground);
  await tab(page, "Sentence replacements").click();
  await acceptVoiceover(page);
  await tab(page, "Empty drop").click();
  const completed = await waitProject(
    page,
    initial.id,
    (p) => p.tracks.length === beforeBackground.tracks.length + 1,
  );
  assertScoped(completed, completed.tracks.at(-1)!.id, target.id);
  await expect(tab(page, "Empty drop")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await unchanged(page, scratch);

  // The empty body retains its first-import path; only its AI response is held out of this media/UI test.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("studio:analyze");
    ipcMain.handle("studio:analyze", (_event, input: MixProject) => input);
  });
  await dragFile(page, current(page).locator(".welcome"), "dragover");
  await expect(
    current(page).locator(".drop-overlay,.take-drop-overlay"),
  ).toBeVisible();
  await dragFile(page, current(page).locator(".welcome"), "drop");
  const importedEmpty = await waitProject(
    page,
    scratch.id,
    (p) => p.tracks.length === 1,
  );
  expect(importedEmpty.tracks[0].sentenceGroupId).toBeUndefined();
  await ready(page);
  const setup = page.getByRole("dialog");
  if (await setup.count())
    await setup
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
  await tab(page, "Sentence replacements").click();
  await ready(page);

  // Cancel a waiting import, then let the picker complete: no late callback may adopt its audio.
  const beforeCancel = await project(page, initial.id);
  await holdPicker(app);
  await add().click();
  await current(page)
    .locator(".progress-banner")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await ready(page);
  await releasePicker(app, [files[1]]);
  await unchanged(page, beforeCancel);
  await dismiss(page);

  // Save and reopen a copied portable manifest so audio authorization and scope both remap.
  const portable = path.join(temporary, "Replacement mix.mixstudio");
  await app.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, portable);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: "save" }),
    ),
  );
  await expect(
    current(page).getByText("Project saved.", { exact: true }),
  ).toBeVisible();
  const copied = path.join(temporary, "Copy of replacement mix.mixstudio");
  await copyFile(portable, copied);
  await picker(app, [copied]);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: "open" }),
    ),
  );
  await expect(page.locator(".studio-tab-label")).toHaveCount(3);
  const copiedWorkspace = await workspace(page);
  const copiedProject = copiedWorkspace.projects.find(
    (entry) => entry.id === copiedWorkspace.activeProjectId,
  )!;
  expect(copiedProject.id).not.toBe(initial.id);
  expect(
    copiedProject.tracks.map((track) => [track.name, track.sentenceGroupId]),
  ).toEqual(
    beforeCancel.tracks.map((track) => [track.name, track.sentenceGroupId]),
  );
  expect(
    copiedProject.tracks.every(
      (track, index) => track.id !== beforeCancel.tracks[index].id,
    ),
  ).toBe(true);
  for (const track of copiedProject.tracks.filter(
    (track) => track.sentenceGroupId,
  ))
    assertScoped(copiedProject, track.id, track.sentenceGroupId!);
  await page.locator(".studio-project-tab.active .studio-tab-close").click();
  await tab(page, "Sentence replacements").click();
  const saved = await project(page, initial.id);
  const output = path.join(temporary, "with-snippet.wav");
  const firstExport = await exportWav(app, page, output);
  expect(
    Math.abs(firstExport.duration - masterDuration(saved)),
  ).toBeLessThanOrEqual(1 / 48_000);
  const snippetClip = masterClips(saved).find(
    (clip) => clip.trackId === snippet.id,
  )!;
  const preview = await page.evaluate(
    async (track) =>
      Array.from(
        new Float32Array(
          await window.studio.audioSlice(track.id, 0, track.duration),
        ),
      ),
    snippet,
  );
  const startFrame = Math.round(snippetClip.offset * 48_000);
  const endFrame = startFrame + Math.round(snippetClip.duration * 48_000);
  const decoded = await runProcess(ffmpeg, [
    "-v",
    "error",
    "-i",
    output,
    "-af",
    `atrim=start_sample=${startFrame}:end_sample=${endFrame}`,
    "-f",
    "f32le",
    "-",
  ]);
  const samples = new Float32Array(
    decoded.stdout.buffer,
    decoded.stdout.byteOffset,
    decoded.stdout.byteLength / 4,
  );
  expect(samples.length).toBe(preview.length);
  let sampleError = 0;
  for (let index = 0; index < samples.length; index++)
    sampleError = Math.max(
      sampleError,
      Math.abs(samples[index] - preview[index]),
    );
  expect(sampleError).toBeLessThan(0.000001);
  await dismiss(page);
  await current(page)
    .locator(".editor-content")
    .evaluate((element) => {
      element.scrollTop = 0;
    });

  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(tab(page, "Sentence replacements")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const restored = await project(page, initial.id);
  expect(restored.tracks).toEqual(saved.tracks);
  expect(restored.groups).toEqual(saved.groups);
  expect(restored.segments).toEqual(saved.segments);
  const secondExport = await exportWav(
    app,
    page,
    path.join(temporary, "after-restart.wav"),
  );
  expect(secondExport).toEqual(firstExport);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        sentenceImports: {
          nativePicker: true,
          targetOnly: true,
          wholeSource: true,
          initiallyUnselected: true,
          actualPreview: true,
          wholeCardSelection: true,
          undoRedo: true,
          multipleFileDrop: true,
          oneHoverTarget: true,
        },
        fullImports: {
          sidebar: true,
          master: true,
          musicWorkspace: true,
          emptyBody: true,
          choiceBlankToolbarAndSearchRejected: true,
        },
        reliability: {
          invalidFileUnchanged: true,
          cancelledPickerUnchanged: true,
          cancelRejectsLatePicker: true,
          backgroundOriginOnly: true,
          portableSourcesRemappedWithScope: true,
          restart: true,
        },
        export: {
          ...secondExport,
          byteIdenticalAcrossRestart: true,
          snippetPreviewMaximumSampleError: sampleError,
        },
        screenshot: "artifacts/sentence-snippets.png",
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
