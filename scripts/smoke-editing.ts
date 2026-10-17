/** Native editing regressions. Generated demo speech, isolated profile, real PCM/export. */
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  effectiveJointSettings,
  masterClips,
  masterDuration,
} from "../src/domain/project";
import type { MixProject, WorkspaceSession } from "../src/shared/types";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-editing-"));
const profile = path.join(temporary, "profile");
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const errors: string[] = [];
const screenshots: string[] = [];
const exportMenuBounds: { width: number; height: number }[] = [];
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
function tab(page: Page, name: string) {
  return page
    .getByRole("tablist", { name: "Projects", exact: true })
    .getByRole("tab", { name, exact: true });
}
async function workspace(page: Page): Promise<WorkspaceSession> {
  const value = await page.evaluate(() => window.studio.restoreWorkspace());
  if (!value) throw new Error("The workspace was not saved.");
  return value;
}
async function project(page: Page, id: string): Promise<MixProject> {
  const value = (await workspace(page)).projects.find(
    (entry) => entry.id === id,
  );
  if (!value) throw new Error("The expected mix is missing.");
  return value;
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
  return (await workspace(page)).projects.find((p) => p.name === name)!;
}
async function demoFromGuide(page: Page) {
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
  await expect(current(page).locator(".take")).toHaveCount(3);
}
async function closeSettings(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
}
async function settings(page: Page) {
  await current(page)
    .getByRole("button", { name: "Studio settings", exact: true })
    .click();
  return page.getByRole("dialog");
}
async function setRange(slider: Locator, target: number) {
  await slider.focus();
  const currentValue = Number(await slider.inputValue());
  const step = Number(await slider.getAttribute("step")) || 1;
  const direction = target > currentValue ? "ArrowRight" : "ArrowLeft";
  for (let index = 0; index < Math.abs(target - currentValue) / step; index++)
    await slider.press(direction);
  await expect(slider).toHaveValue(String(target));
}
async function clearNotice(page: Page) {
  const dismiss = current(page).getByRole("button", {
    name: "Dismiss notification",
    exact: true,
  });
  if (await dismiss.count()) await dismiss.click();
}
async function openExportMenu(page: Page) {
  const sidebar = current(page).locator(".sidebar");
  const trigger = sidebar.getByRole("button", {
    name: "Export master",
    exact: true,
  });
  await trigger.click();
  const menu = sidebar.locator(".export-menu");
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  const viewport = await sidebar.boundingBox();
  const button = await trigger.boundingBox();
  if (
    !bounds ||
    !viewport ||
    !button ||
    bounds.x < viewport.x - 1 ||
    bounds.y < viewport.y - 1 ||
    bounds.x + bounds.width > viewport.x + viewport.width + 1 ||
    bounds.y + bounds.height > viewport.y + viewport.height + 1 ||
    bounds.y + bounds.height > button.y + 1
  )
    throw new Error(
      `The export menu is clipped or does not open above its trigger: ${JSON.stringify({ bounds, viewport, button })}`,
    );
  for (const name of [/WAV audio/, /MP3 audio/])
    await menu.getByRole("button", { name }).click({ trial: true });
  exportMenuBounds.push(
    await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  );
}
async function exportWav(
  application: ElectronApplication,
  page: Page,
  filename: string | null,
) {
  await application.evaluate(({ dialog }, output) => {
    dialog.showSaveDialog = async () =>
      output ? { canceled: false, filePath: output } : { canceled: true };
  }, filename);
  await openExportMenu(page);
  await current(page)
    .getByRole("button", { name: /WAV audio/ })
    .click();
  if (!filename) {
    await expect(
      current(page).getByRole("button", { name: "Export master", exact: true }),
    ).toBeEnabled();
    return null;
  }
  await expect(
    current(page).getByText("Exported WAV.", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const output = await runProcess(await findBinary("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    filename,
  ]);
  return {
    duration: Number(output.stdout.toString()),
    sha256: createHash("sha256")
      .update(await readFile(filename))
      .digest("hex"),
  };
}
async function capture(application: ElectronApplication, page: Page) {
  for (const [size, width, height] of [
    ["small", 1024, 720],
    ["default", 1440, 900],
  ] as const) {
    await application.evaluate(
      ({ BrowserWindow }, dimensions) =>
        BrowserWindow.getAllWindows()[0].setContentSize(
          dimensions.width,
          dimensions.height,
        ),
      { width, height },
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      )
      .toEqual({ width, height });
    for (const theme of ["light", "dark"] as const) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", {
            name: theme === "light" ? "Use light mode" : "Use dark mode",
            exact: true,
          })
          .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const mode of ["choices", "manual", "settings"] as const) {
        if (mode === "settings") {
          const dialog = await settings(page);
          await expect(
            dialog.getByRole("combobox", { name: "Codex model", exact: true }),
          ).toBeEnabled({ timeout: 30_000 });
          await dialog.evaluate((element) => {
            element.scrollTop = 0;
          });
        } else {
          await current(page)
            .getByRole("tab", {
              name: mode === "choices" ? /^Sentence choices/ : "Manual edit",
            })
            .click();
          await current(page)
            .locator(".editor-content")
            .evaluate((element) => {
              element.scrollTop = 0;
            });
        }
        await page.mouse.move(width - 5, height - 5);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        if (overflow)
          throw new Error(`${theme}/${mode}/${size} overflows horizontally.`);
        const artifact = `artifacts/editing-${theme}-${mode}-${size}.png`;
        await page.screenshot({ path: path.join(root, artifact) });
        screenshots.push(artifact);
        if (mode === "settings") await closeSettings(page);
      }
    }
  }
}

try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New tab", exact: true }),
  ).toBeEnabled();
  await expect(
    current(page).getByRole("button", { name: "Quick guide", exact: true }),
  ).toBeVisible();
  await expect(
    current(page).locator(".demo-button,.workspace-header,.workspace-footer"),
  ).toHaveCount(0);
  await expect(page.locator(".studio-reopen-tab")).toHaveCount(0);
  const initial = await workspace(page);
  await demoFromGuide(page);
  const a = await rename(page, "Narration mix");
  expect(a.id).toBe(initial.activeProjectId);
  expect((await workspace(page)).projects).toHaveLength(1);
  await demoFromGuide(page);
  const b = await rename(page, "Alternate mix");
  expect(b.id).not.toBe(a.id);
  expect((await workspace(page)).projects).toHaveLength(2);
  expect((await project(page, a.id)).segments).toEqual(a.segments);
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  const blank = await rename(page, "Reusable empty mix");
  await tab(page, "Narration mix").click();
  await demoFromGuide(page);
  const c = await rename(page, "Closed demo");
  expect(c.id).toBe(blank.id);
  expect((await workspace(page)).projects).toHaveLength(3);
  await current(page)
    .locator(".sentence-row")
    .first()
    .locator(".variation-select")
    .nth(1)
    .click();
  await current(page)
    .getByRole("button", { name: "Increase sentence 1 speed", exact: true })
    .click();
  const editedLastDemo = await waitProject(
    page,
    c.id,
    (p) => p.groups[0].speed === 1.25,
  );
  await page
    .getByRole("button", { name: "Close Closed demo", exact: true })
    .click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: "reopen-tab" }),
    ),
  );
  await expect(tab(page, "Closed demo")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("button", { name: "Close Closed demo", exact: true }),
  ).toBeEnabled();
  await expect(current(page).locator(".progress-banner")).toHaveCount(0);
  const reopenedLastDemo = await project(page, c.id);
  expect(reopenedLastDemo.tracks).toEqual(editedLastDemo.tracks);
  expect(reopenedLastDemo.groups).toEqual(editedLastDemo.groups);
  expect(reopenedLastDemo.segments).toEqual(editedLastDemo.segments);
  expect(masterClips(reopenedLastDemo)).toEqual(masterClips(editedLastDemo));
  await page
    .getByRole("button", { name: "Close Closed demo", exact: true })
    .click();
  await tab(page, "Narration mix").click();

  const sidebar = current(page).locator(".sidebar");
  expect(
    await sidebar.locator(".sidebar-bottom button").allTextContents(),
  ).toEqual(["Quick guide", "Studio settings"]);
  await expect(
    sidebar.locator(
      ".sidebar-bottom .dot,.sidebar-bottom kbd,.sidebar-bottom .help-badge",
    ),
  ).toHaveCount(0);
  const add = await sidebar
    .getByRole("button", { name: "Add audio takes", exact: true })
    .boundingBox();
  const download = await sidebar
    .getByRole("button", { name: "Export master", exact: true })
    .boundingBox();
  if (!add || !download || download.y < add.y + add.height)
    throw new Error("Export is not below Add audio takes in the sidebar.");
  const cards = await sidebar.locator(".take").evaluateAll((elements) =>
    elements.map((element) => ({
      filename: element.querySelector(".take-filename")?.textContent,
      take: element.querySelector(".take-name")?.textContent,
      share: element.querySelector(".take-metadata strong")?.textContent,
      color: getComputedStyle(element.querySelector(".take-metadata strong")!)
        .color,
      icon: !!element.querySelector(".take-symbol svg"),
    })),
  );
  const initialClips = masterClips(await project(page, a.id));
  const initialMixDuration = initialClips.reduce(
    (sum, clip) => sum + clip.duration,
    0,
  );
  cards.forEach((card, index) => {
    expect(card.filename).toBe(a.tracks[index].name);
    expect(card.take).toBe(`Take ${index + 1}`);
    const duration = initialClips
      .filter((clip) => clip.trackId === a.tracks[index].id)
      .reduce((sum, clip) => sum + clip.duration, 0);
    expect(card.share).toBe(
      `${Math.round((duration / initialMixDuration) * 100)}% of mix`,
    );
    expect(card.icon).toBe(true);
  });

  const row = current(page).locator(".sentence-row").first();
  const variations = row.locator(".variation");
  await expect(
    row.locator(
      ".variation-name,.variation-top,.choose-button,.variation-text",
    ),
  ).toHaveCount(0);
  const first = variations.nth(0).locator(".variation-select");
  const second = variations.nth(1).locator(".variation-select");
  await page.evaluate(() => {
    const scope = window as typeof window & { __editingAudioStarts?: number[] };
    scope.__editingAudioStarts = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      scope.__editingAudioStarts!.push(this.buffer?.duration ?? 0);
      return Reflect.apply(original, this, args);
    };
  });
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await variations.nth(1).locator(".preview-button").click();
  await expect(variations.nth(1).locator(".preview-button")).toHaveAttribute(
    "aria-label",
    /^Stop /,
  );
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __editingAudioStarts?: number[] })
            .__editingAudioStarts?.[0] ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await variations.nth(1).locator(".preview-button").click();
  const cardBox = await variations.nth(1).boundingBox();
  if (!cardBox) throw new Error("The source variation is missing.");
  await variations
    .nth(1)
    .click({ position: { x: cardBox.width - 8, y: cardBox.height - 8 } });
  await expect(second).toHaveAttribute("aria-pressed", "true");

  const increase = row.getByRole("button", {
    name: "Increase sentence 1 speed",
    exact: true,
  });
  const decrease = row.getByRole("button", {
    name: "Decrease sentence 1 speed",
    exact: true,
  });
  const beforeSpeed = await project(page, a.id);
  await increase.click();
  const faster = await waitProject(
    page,
    a.id,
    (p) => p.groups[0].speed === 1.25,
  );
  expect(masterDuration(faster)).toBeLessThan(masterDuration(beforeSpeed));
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await waitProject(page, a.id, (p) => p.groups[0].speed === 1);
  for (let index = 0; index < 2; index++) await decrease.click();
  await expect(decrease).toBeDisabled();
  await waitProject(page, a.id, (p) => p.groups[0].speed === 0.5);
  for (let index = 0; index < 8; index++) await increase.click();
  await expect(increase).toBeDisabled();
  await waitProject(page, a.id, (p) => p.groups[0].speed === 2.5);
  for (let index = 0; index < 5; index++) await decrease.click();
  await waitProject(page, a.id, (p) => p.groups[0].speed === 1.25);

  const beforeSkip = await project(page, a.id);
  await current(page)
    .getByRole("button", { name: "Skip sentence 2", exact: true })
    .click();
  const audibleJoint = current(page).getByRole("group", {
    name: "Joint between sentences 1 and 3",
    exact: true,
  });
  await expect(audibleJoint).toBeVisible();
  const skipped = await project(page, a.id);
  const pauseControl = audibleJoint
    .locator(".joint-control")
    .filter({ has: page.getByRole("button", { name: /^Pause:/ }) });
  await pauseControl.hover();
  await setRange(
    pauseControl.getByRole("slider", {
      name: "Pause milliseconds",
      exact: true,
    }),
    10,
  );
  const withAudiblePause = await waitProject(
    page,
    a.id,
    (p) =>
      effectiveJointSettings(p, p.groups[0].id, p.groups[2].id).pauseMs === 10,
  );
  expect(
    masterDuration(withAudiblePause) - masterDuration(skipped),
  ).toBeCloseTo(0.01, 6);
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await current(page)
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  const restoredAfterSkip = await waitProject(page, a.id, (p) =>
    masterClips(p).some((clip) => clip.groupId === p.groups[1].id),
  );
  expect(masterClips(restoredAfterSkip)).toEqual(masterClips(beforeSkip));

  let dialog = await settings(page);
  for (const label of [
    "Default fade-in clip edge milliseconds",
    "Default fade-out clip edge milliseconds",
    "Default pause milliseconds",
  ])
    await expect(
      dialog.getByRole("spinbutton", { name: label, exact: true }),
    ).toHaveValue("0");
  await dialog
    .getByRole("spinbutton", {
      name: "Default fade-in clip edge milliseconds",
      exact: true,
    })
    .fill("100");
  await dialog
    .getByRole("spinbutton", {
      name: "Default fade-out clip edge milliseconds",
      exact: true,
    })
    .fill("200");
  await dialog
    .getByRole("spinbutton", {
      name: "Default pause milliseconds",
      exact: true,
    })
    .fill("300");
  const model = dialog.getByRole("combobox", {
    name: "Codex model",
    exact: true,
  });
  await expect(model).toBeEnabled({ timeout: 30_000 });
  const catalog = await page.evaluate(() => window.studio.codexModels());
  const chosenModel =
    catalog.find((entry) => entry.fast && entry.reasoning.length > 1) ??
    catalog[0];
  if (!chosenModel)
    throw new Error("The installed Codex returned no selectable models.");
  await model.selectOption(chosenModel.id);
  const reasoning = chosenModel.reasoning.at(-1)!;
  await dialog
    .getByRole("combobox", { name: "Reasoning", exact: true })
    .selectOption(reasoning);
  if (chosenModel.fast)
    await dialog.getByRole("button", { name: "Fast", exact: true }).click();
  await closeSettings(page);
  const joint = current(page).getByRole("group", {
    name: "Joint between sentences 1 and 2",
    exact: true,
  });
  expect(await joint.locator(".joint-value").allTextContents()).toEqual([
    "200ms fade out",
    "300ms pause",
    "100ms fade in",
  ]);
  for (const [label, value] of [
    ["Fade out", 80],
    ["Pause", 120],
    ["Fade in", 60],
  ] as const) {
    const control = joint.locator(".joint-control").filter({
      has: page.getByRole("button", { name: new RegExp(`^${label}:`) }),
    });
    await control.hover();
    await setRange(
      control.getByRole("slider", {
        name: `${label} milliseconds`,
        exact: true,
      }),
      value,
    );
  }
  dialog = await settings(page);
  await dialog
    .getByRole("spinbutton", {
      name: "Default fade-in clip edge milliseconds",
      exact: true,
    })
    .fill("110");
  await dialog
    .getByRole("spinbutton", {
      name: "Default fade-out clip edge milliseconds",
      exact: true,
    })
    .fill("210");
  await dialog
    .getByRole("spinbutton", {
      name: "Default pause milliseconds",
      exact: true,
    })
    .fill("330");
  await closeSettings(page);
  const edited = await waitProject(
    page,
    a.id,
    (p) => p.jointDefaults?.pauseMs === 330,
  );
  expect(
    effectiveJointSettings(edited, edited.groups[0].id, edited.groups[1].id),
  ).toEqual({ fadeOutMs: 80, pauseMs: 120, fadeInMs: 60 });
  expect(
    effectiveJointSettings(edited, edited.groups[1].id, edited.groups[2].id),
  ).toEqual({ fadeOutMs: 210, pauseMs: 330, fadeInMs: 110 });
  expect(edited.codex).toEqual({
    model: chosenModel.id,
    reasoning,
    fast: chosenModel.fast,
  });

  // A joint at the top edge must place its slider below the control rather
  // than inside the scroll container's clipped area.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1024, 720),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1024, height: 720 });
  const editorPanel = current(page).locator(".editor-content");
  await editorPanel.evaluate((element) => {
    const control = element.querySelector(".joint-divider .joint-control")!;
    element.scrollTop +=
      control.getBoundingClientRect().top -
      element.getBoundingClientRect().top -
      8;
  });
  const topControl = current(page)
    .locator(".joint-divider .joint-control")
    .first();
  await page.mouse.move(2, 2);
  await topControl.hover();
  await expect(topControl).toHaveAttribute("data-placement", "below");
  const popup = await topControl.locator(".joint-popover").boundingBox();
  const panel = await editorPanel.boundingBox();
  if (
    !popup ||
    !panel ||
    popup.y < panel.y - 1 ||
    popup.y + popup.height > panel.y + panel.height + 1 ||
    popup.x < panel.x - 1 ||
    popup.x + popup.width > panel.x + panel.width + 1
  )
    throw new Error(
      `A joint slider is clipped at the editor viewport edge: ${JSON.stringify({ popup, panel })}`,
    );
  await expect(
    topControl.getByRole("slider", {
      name: "Fade out milliseconds",
      exact: true,
    }),
  ).toBeVisible();
  await topControl
    .getByRole("slider", { name: "Fade out milliseconds", exact: true })
    .click({ trial: true });
  await page.mouse.move(2, 2);
  await openExportMenu(page);
  await page.keyboard.press("Escape");
  await expect(current(page).locator(".export-menu")).toHaveCount(0);
  await editorPanel.evaluate((element) => {
    element.scrollTop = 0;
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1440, height: 900 });

  const timeline = current(page).locator(".master-timeline");
  await timeline.hover();
  await page.mouse.wheel(0, -150);
  await expect
    .poll(async () => Number(await timeline.getAttribute("data-zoom")))
    .toBeGreaterThan(1);
  await page.keyboard.press("Meta+0");
  await expect(timeline).toHaveAttribute("data-zoom", "1.000");
  await timeline.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -200,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 3,
      }),
    );
  });
  await expect
    .poll(async () => Number(await timeline.getAttribute("data-zoom")))
    .toBeGreaterThan(1);
  const leftBefore = await timeline.evaluate((element) => element.scrollLeft);
  await page.mouse.wheel(180, 0);
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(leftBefore);
  await page.keyboard.press("Meta+-");
  const minusZoom = Number(await timeline.getAttribute("data-zoom"));
  await page.keyboard.press("Meta++");
  await expect
    .poll(async () => Number(await timeline.getAttribute("data-zoom")))
    .toBeGreaterThan(minusZoom);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
  ).toBe(1);
  await page.keyboard.press("Meta+0");
  await expect(timeline).toHaveAttribute("data-zoom", "1.000");
  await current(page).locator(".master-clip").first().hover();
  await expect(page.getByRole("tooltip")).toContainText(edited.groups[0].text);
  const waveformLayout = await current(page)
    .locator(".master-clip")
    .first()
    .evaluate((clip) => {
      const wave = clip.querySelector(".waveform")!;
      const box = clip.getBoundingClientRect();
      const waveBox = wave.getBoundingClientRect();
      const style = getComputedStyle(clip);
      return {
        left: waveBox.left - box.left,
        right: box.right - waveBox.right,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });
  expect(waveformLayout.paddingLeft).toBe("0px");
  expect(waveformLayout.paddingRight).toBe("0px");
  expect(Math.abs(waveformLayout.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(waveformLayout.right)).toBeLessThanOrEqual(1);
  const dividerStyle = await current(page)
    .locator(".master-clip")
    .nth(1)
    .evaluate((clip) => {
      const style = getComputedStyle(clip);
      return {
        width: parseFloat(style.borderLeftWidth),
        color: style.borderLeftColor,
      };
    });
  expect(dividerStyle.width).toBeGreaterThan(0);
  expect(dividerStyle.width).toBeLessThanOrEqual(1);
  const rgb = [...dividerStyle.color.matchAll(/[\d.]+/g)]
    .slice(0, 3)
    .map((value) => Number(value[0]));
  if (rgb.length !== 3 || Math.max(...rgb) - Math.min(...rgb) > 20)
    throw new Error(
      `The clip divider is not a neutral grey: ${dividerStyle.color}`,
    );
  await page.mouse.move(5, 5);

  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await openExportMenu(page);
  await current(page)
    .getByRole("button", { name: /MP3 audio/ })
    .click();
  await expect(
    current(page).getByRole("button", { name: "Export master", exact: true }),
  ).toBeEnabled();
  await exportWav(app, page, null);
  await expect(
    sidebar.getByRole("button", { name: "Quick guide", exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.studio.preferences())).hasExportedMaster,
  ).toBe(false);
  const firstExport = await exportWav(
    app,
    page,
    path.join(temporary, "edited-master.wav"),
  );
  if (
    !firstExport ||
    Math.abs(firstExport.duration - masterDuration(edited)) > 1 / 48_000
  )
    throw new Error(
      `Actual WAV duration does not match speed/pause edits: ${JSON.stringify({ firstExport, expected: masterDuration(edited) })}`,
    );
  await expect(
    sidebar.getByRole("button", { name: "Quick guide", exact: true }),
  ).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.studio.preferences())).hasExportedMaster,
  ).toBe(true);
  await clearNotice(page);
  await capture(app, page);

  const saved = await project(page, a.id);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".studio-tab-label")).toHaveCount(2);
  await expect(tab(page, "Narration mix")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    current(page).locator(".sidebar-bottom .guide-button"),
  ).toHaveCount(0);
  const restored = await project(page, a.id);
  expect(restored.groups).toEqual(saved.groups);
  expect(restored.jointDefaults).toEqual(saved.jointDefaults);
  expect(restored.jointOverrides).toEqual(saved.jointOverrides);
  expect(restored.codex).toEqual(saved.codex);
  expect(masterClips(restored)).toEqual(masterClips(saved));
  const secondExport = await exportWav(
    app,
    page,
    path.join(temporary, "restored-master.wav"),
  );
  expect(secondExport).toEqual(firstExport);
  dialog = await settings(page);
  await expect(
    dialog.getByRole("button", { name: "Quick guide", exact: true }),
  ).toBeVisible();
  await closeSettings(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-shortcut", { detail: "reopen-tab" }),
    ),
  );
  await expect(tab(page, "Closed demo")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(current(page).locator(".sentence-row")).toHaveCount(4);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        demo: {
          guideOnly: true,
          emptyTabReused: true,
          nonemptyMixPreserved: true,
          existingEmptyTabReused: true,
          lastDemoReopenPreservesEditsWithoutRegeneration: true,
        },
        editing: {
          wholeCardSelection: true,
          previewDoesNotSelect: true,
          speedBoundsAndUndo: true,
          skippedMiddleJointTargetsAudibleNeighbors: true,
          jointControlsAndOverrides: true,
          scrolledJointSliderRemainsInsideViewport: true,
          zoomWheelPinchKeyboardPan: true,
          browserZoom: 1,
          tooltip: true,
          waveformLayout,
        },
        sidebar: {
          exportBelowAdd: true,
          exportMenuBounds,
          compactSourceCards: true,
          guideUntilRealExport: true,
          noFooterOrHeader: true,
        },
        codexSelection: saved.codex,
        exportRoundtrip: {
          ...secondExport,
          byteIdentical: true,
          expectedDuration: masterDuration(saved),
        },
        restart: {
          speed: true,
          joints: true,
          codex: true,
          guidePreference: true,
          openAndClosedTabs: true,
        },
        screenshots,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
