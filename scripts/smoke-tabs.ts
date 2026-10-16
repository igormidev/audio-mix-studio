/** New workspace behavior, using real demo audio and an isolated native profile. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { masterDuration } from "../src/domain/project";
import type { MixProject, WorkspaceSession } from "../src/shared/types";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-tabs-"));
const profile = path.join(temporary, "profile");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
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
function projectTab(page: Page, name: string) {
  return page
    .getByRole("tablist", { name: "Projects", exact: true })
    .getByRole("tab", { name, exact: true });
}
async function snapshot(page: Page): Promise<WorkspaceSession> {
  const value = await page.evaluate(() => window.studio.restoreWorkspace());
  if (!value) throw new Error("No workspace was saved.");
  return value;
}
async function savedProject(page: Page, name: string): Promise<MixProject> {
  await expect
    .poll(async () =>
      (await snapshot(page)).projects.some((p) => p.name === name),
    )
    .toBe(true);
  return (await snapshot(page)).projects.find((p) => p.name === name)!;
}
async function rename(page: Page, name: string) {
  await page.locator('.studio-tab-label[aria-selected="true"]').dblclick();
  const field = page.getByRole("textbox", { name: "Rename tab", exact: true });
  await field.fill(name);
  await field.press("Enter");
  await expect(projectTab(page, name)).toHaveAttribute("aria-selected", "true");
  await savedProject(page, name);
}
async function loadDemo(page: Page, name: string) {
  await current(page).locator(".demo-button").click();
  await expect(current(page).locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  await rename(page, name);
}
async function choose(page: Page, take: "02" | "03") {
  const button = current(page)
    .locator(".sentence-row")
    .first()
    .getByRole("button", { name: new RegExp(`^Use Take ${take}`) });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
function selections(project: MixProject) {
  return project.segments.map(({ id, enabled, start, end, trackId }) => ({
    id,
    enabled,
    start,
    end,
    trackId,
  }));
}
async function exportWav(
  application: ElectronApplication,
  page: Page,
  output: string,
) {
  await application.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: filename,
    });
  }, output);
  await current(page)
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: /WAV audio/ })
    .click();
  await expect(
    current(page).getByText("Exported WAV.", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  const probe = await runProcess(await findBinary("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    output,
  ]);
  return {
    duration: Number(probe.stdout.toString()),
    sha256: createHash("sha256")
      .update(await readFile(output))
      .digest("hex"),
  };
}

async function previewLatency(page: Page) {
  await page.evaluate(() => {
    const probe = {
      clickedAt: 0,
      starts: [] as {
        schedulingMs: number;
        scheduledLeadMs: number;
        baseLatency: number;
        outputLatency: number;
      }[],
    };
    const scope = window as typeof window & {
      __mixstudioPlaybackProbe?: typeof probe;
    };
    scope.__mixstudioPlaybackProbe = probe;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const audio = this.context as AudioContext;
      probe.starts.push({
        schedulingMs: performance.now() - probe.clickedAt,
        scheduledLeadMs: ((args[0] ?? 0) - audio.currentTime) * 1000,
        baseLatency: audio.baseLatency,
        outputLatency: audio.outputLatency,
      });
      return Reflect.apply(start, this, args);
    };
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element).closest(".preview-button"))
          probe.clickedAt = performance.now();
      },
      true,
    );
  });
  const preview = current(page)
    .locator(".sentence-row")
    .first()
    .locator(".preview-button")
    .first();
  const samples = [];
  for (const temperature of ["cold", "warm"] as const) {
    await preview.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scope = window as typeof window & {
            __mixstudioPlaybackProbe?: { starts: unknown[] };
          };
          return scope.__mixstudioPlaybackProbe?.starts.length ?? 0;
        }),
      )
      .toBe(samples.length + 1);
    const sample = await page.evaluate(() => {
      const scope = window as typeof window & {
        __mixstudioPlaybackProbe?: {
          starts: {
            schedulingMs: number;
            scheduledLeadMs: number;
            baseLatency: number;
            outputLatency: number;
          }[];
        };
      };
      return scope.__mixstudioPlaybackProbe!.starts.at(-1)!;
    });
    if (!Number.isFinite(sample.schedulingMs) || sample.schedulingMs < 0)
      throw new Error("The real preview did not produce a timing measurement.");
    samples.push({ temperature, ...sample });
    await preview.click();
  }
  return samples;
}

try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New tab", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "New tab", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".studio-tab-label")).toHaveCount(2);
  await page.locator(".studio-project-tab.active .studio-tab-close").click();
  await expect(page.locator(".studio-tab-label")).toHaveCount(1);
  await loadDemo(page, "Delivery A");

  // Double-click editing supports cancellation as well as committing a name.
  await projectTab(page, "Delivery A").dblclick();
  await page
    .getByRole("textbox", { name: "Rename tab", exact: true })
    .fill("Discard me");
  await page
    .getByRole("textbox", { name: "Rename tab", exact: true })
    .press("Escape");
  await expect(projectTab(page, "Delivery A")).toBeVisible();

  const latency = await previewLatency(page);
  const waveform = await current(page).evaluate((panel) => ({
    waveforms: panel.querySelectorAll("svg.waveform").length,
    paths: panel.querySelectorAll("svg.waveform path").length,
    rectangles: panel.querySelectorAll("svg.waveform rect").length,
  }));
  if (
    !waveform.waveforms ||
    waveform.paths !== waveform.waveforms ||
    waveform.rectangles
  )
    throw new Error(
      `Waveforms did not use compact paths: ${JSON.stringify(waveform)}`,
    );
  await choose(page, "02");
  const a = await savedProject(page, "Delivery A");
  const before = await exportWav(app, page, path.join(temporary, "before.wav"));
  if (Math.abs(before.duration - masterDuration(a)) > 1 / 48_000)
    throw new Error(
      "The original export differs from its selected source durations.",
    );

  await current(page)
    .getByRole("button", { name: "Play master", exact: true })
    .click();
  await expect(
    current(page).getByRole("slider", { name: "Seek master track" }),
  ).not.toHaveValue("0");
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.locator(".studio-tab-label")).toHaveCount(2);
  await expect(
    page
      .locator(`#project-panel-${a.id}`)
      .locator('button[aria-label="Play master"]'),
  ).toHaveCount(1);
  await loadDemo(page, "Delivery B");
  await choose(page, "03");
  await current(page)
    .getByRole("tab", { name: "Manual edit", exact: true })
    .click();
  const enabled = await current(page)
    .locator(".source-segment.enabled")
    .count();
  await current(page).locator(".source-segment.enabled").first().click();
  await expect(current(page).locator(".source-segment.enabled")).toHaveCount(
    enabled - 1,
  );
  const b = await savedProject(page, "Delivery B");

  await projectTab(page, "Delivery A").click();
  await expect(
    current(page)
      .locator(".sentence-row")
      .first()
      .getByRole("button", { name: /^Use Take 02/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(selections(await savedProject(page, "Delivery A"))).toEqual(
    selections(a),
  );

  // Hold one analysis response in the test process only. All application code,
  // ownership, UI busy handling, and persistence remain production code.
  await app.evaluate(({ ipcMain }) => {
    const scope = globalThis as typeof globalThis & {
      __mixstudioPendingAnalysis?: {
        project: MixProject;
        finish: (project: MixProject) => void;
      };
    };
    ipcMain.removeHandler("studio:analyze");
    ipcMain.handle(
      "studio:analyze",
      async (_event, project: MixProject) =>
        new Promise<MixProject>((resolve) => {
          scope.__mixstudioPendingAnalysis = { project, finish: resolve };
        }),
    );
  });
  await current(page)
    .getByRole("button", { name: "Regroup sentences", exact: true })
    .click();
  await current(page)
    .getByRole("dialog")
    .getByRole("button", { name: "Regroup sentences", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close Delivery A", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await rename(page, "Scratch");
  await page
    .getByRole("button", { name: "Use dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await projectTab(page, "Delivery B").click();
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(current(page).locator(".source-segment.enabled")).toHaveCount(
    enabled,
  );
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await expect(current(page).locator(".source-segment.enabled")).toHaveCount(
    enabled - 1,
  );
  await app.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __mixstudioPendingAnalysis?: {
        project: MixProject;
        finish: (project: MixProject) => void;
      };
    };
    const pending = scope.__mixstudioPendingAnalysis;
    if (!pending)
      throw new Error("The UI did not start the held background analysis.");
    pending.project.groups[0].note = "Background completion verified";
    pending.finish(pending.project);
    delete scope.__mixstudioPendingAnalysis;
  });
  await expect(
    page.getByRole("button", { name: "Close Delivery A", exact: true }),
  ).toBeEnabled();
  await expect(projectTab(page, "Delivery B")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect
    .poll(async () => (await savedProject(page, "Delivery A")).groups[0].note)
    .toBe("Background completion verified");
  expect(selections(await savedProject(page, "Delivery A"))).toEqual(
    selections(a),
  );
  expect(selections(await savedProject(page, "Delivery B"))).toEqual(
    selections(b),
  );

  await page
    .getByRole("button", { name: "Close Delivery B", exact: true })
    .click();
  await expect(page.locator(".studio-tab-label")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Reopen closed tab", exact: true })
    .click();
  await expect(projectTab(page, "Delivery B")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await current(page)
    .getByRole("tab", { name: "Manual edit", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(current(page).locator(".source-segment.enabled")).toHaveCount(
    enabled,
  );
  await current(page)
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await expect(current(page).locator(".source-segment.enabled")).toHaveCount(
    enabled - 1,
  );
  await page
    .getByRole("button", { name: "Close Scratch", exact: true })
    .click();
  await current(page)
    .getByRole("tab", { name: /^Sentence choices/ })
    .click();
  const notification = current(page).getByRole("button", {
    name: "Dismiss notification",
  });
  if (await notification.count()) await notification.click();
  await current(page)
    .locator(".editor-content")
    .evaluate((element) => {
      element.scrollTop = 0;
    });

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1024, 720),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1024, height: 720 });
  const chrome = await app.evaluate(({ BrowserWindow }) => ({
    position: BrowserWindow.getAllWindows()[0].getWindowButtonPosition(),
  }));
  const layout = await page.evaluate(() => ({
    titlebarHeight: document
      .querySelector(".studio-tabbar")!
      .getBoundingClientRect().height,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  const firstChoice = await current(page)
    .locator(".variation")
    .first()
    .boundingBox();
  if (
    chrome.position?.y !== 17 ||
    layout.titlebarHeight !== 48 ||
    layout.horizontalOverflow ||
    !firstChoice ||
    firstChoice.y + firstChoice.height > 720
  )
    throw new Error(
      `Native titlebar/layout mismatch: ${JSON.stringify({ ...chrome, ...layout })}`,
    );
  await page.screenshot({
    path: path.join(artifacts, "native-tabs-dark-small.png"),
  });
  await page
    .getByRole("button", { name: "Use light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: path.join(artifacts, "native-tabs-light-small.png"),
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.join(artifacts, "native-tabs-light.png"),
  });
  await page
    .getByRole("button", { name: "Use dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: path.join(artifacts, "native-tabs-dark.png") });

  // Exercise the real Settings cancel callback without starting any download.
  await app.evaluate(({ ipcMain }) => {
    const scope = globalThis as typeof globalThis & {
      __mixstudioSetupProbe?: {
        owner: string;
        reject: (error: Error) => void;
        cancelled?: string;
      };
    };
    ipcMain.removeHandler("studio:setup");
    ipcMain.removeHandler("studio:cancel");
    ipcMain.handle(
      "studio:setup",
      (_event, _model, owner: string) =>
        new Promise<never>((_resolve, reject) => {
          scope.__mixstudioSetupProbe = { owner, reject };
        }),
    );
    ipcMain.handle("studio:cancel", (_event, owner: string) => {
      const probe = scope.__mixstudioSetupProbe;
      if (!probe || probe.owner !== owner)
        throw new Error("Settings cancelled the wrong project operation.");
      probe.cancelled = owner;
      probe.reject(new Error("Operation cancelled."));
    });
  });
  await current(page)
    .getByRole("button", { name: "Studio settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Prepare model", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel operation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }),
  ).toBeEnabled();
  const cancelledOwner = await app.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __mixstudioSetupProbe?: { cancelled?: string };
        }
      ).__mixstudioSetupProbe?.cancelled,
  );
  expect(cancelledOwner).toBe(b.id);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  expect(selections(await savedProject(page, "Delivery B"))).toEqual(
    selections(b),
  );

  await expect
    .poll(async () => {
      const saved = JSON.parse(
        await readFile(path.join(profile, "workspace-session.json"), "utf8"),
      ) as WorkspaceSession;
      return {
        count: saved.projects.length,
        active: saved.activeProjectId,
        theme: saved.theme,
        closed: saved.closedProjects?.[0].name,
      };
    })
    .toEqual({ count: 2, active: b.id, theme: "dark", closed: "Scratch" });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".studio-tab-label")).toHaveCount(2);
  await expect(projectTab(page, "Delivery B")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(selections(await savedProject(page, "Delivery A"))).toEqual(
    selections(a),
  );
  expect(selections(await savedProject(page, "Delivery B"))).toEqual(
    selections(b),
  );
  await projectTab(page, "Delivery A").click();
  const after = await exportWav(app, page, path.join(temporary, "after.wav"));
  expect(after).toEqual(before);
  await page
    .getByRole("button", { name: "Reopen closed tab", exact: true })
    .click();
  await expect(projectTab(page, "Scratch")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    current(page).getByRole("button", {
      name: "Import your audio",
      exact: true,
    }),
  ).toBeVisible();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        tabs: {
          independentProjects: true,
          renameDoubleClick: true,
          renameEscape: true,
          keyboardSpaceCreatesTab: true,
          settingsCancellationOwnsItsTab: true,
          independentUndo: true,
          closeReopenHistory: true,
          inactivePlaybackStopped: true,
          backgroundCompletionOwnsItsTab: true,
          busyTabProtected: true,
          coldRestart: true,
          closedTabRecoveredAfterRestart: true,
        },
        appearance: {
          light: true,
          dark: true,
          minimumWindow: { width: 1024, height: 720 },
          ...chrome,
          ...layout,
        },
        previewScheduling: latency,
        waveform,
        exportRoundtrip: { byteIdentical: true, ...after },
        screenshots: [
          "artifacts/native-tabs-dark-small.png",
          "artifacts/native-tabs-light-small.png",
          "artifacts/native-tabs-light.png",
          "artifacts/native-tabs-dark.png",
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
