import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "mixstudio-ui-"));
const artifacts = path.join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
let app = await electron.launch({
  args: [".", `--user-data-dir=${path.join(temporary, "profile")}`],
  cwd: root,
  chromiumSandbox: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Quick guide", exact: true }).click();
  await page
    .getByRole("button", { name: "Let’s make a mix", exact: true })
    .click();
  await expect(page.locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  await expect(
    page.getByRole("button", {
      name: "Use Take 02 · Brighter delivery for sentence 1",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Use Take 02 · Brighter delivery for sentence 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Use Take 02 · Brighter delivery for sentence 1",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", {
      name: "Preview Take 02 · Brighter delivery, sentence 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Stop Take 02 · Brighter delivery, sentence 1",
      exact: true,
    }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page
    .getByRole("button", {
      name: "Stop Take 02 · Brighter delivery, sentence 1",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await page.waitForTimeout(850);
  await expect(
    page.getByRole("slider", { name: "Seek master track" }),
  ).not.toHaveValue("0");
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  await page.getByRole("button", { name: "Return to start" }).click();
  const noticeDismiss = page.getByRole("button", {
    name: "Dismiss notification",
  });
  if (await noticeDismiss.count()) await noticeDismiss.click();
  await page.locator(".editor-content").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: path.join(artifacts, "native-choices.png") });

  await page.getByRole("tab", { name: "Manual edit" }).click();
  await expect(page.locator(".source-segment")).toHaveCount(9);
  const enabledBefore = await page.locator(".source-segment.enabled").count();
  await page.locator(".source-segment.enabled").first().click();
  await expect(page.locator(".source-segment.enabled")).toHaveCount(
    enabledBefore - 1,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".source-segment.enabled")).toHaveCount(
    enabledBefore,
  );
  await page.getByRole("button", { name: /^Cut/ }).click();
  const segment = page.locator(".source-segment.enabled").first();
  const box = await segment.boundingBox();
  if (!box) throw new Error("No selected segment is visible for a manual cut.");
  await segment.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator(".source-segment")).toHaveCount(10);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page
    .locator(".source-segment.enabled")
    .first()
    .click({ button: "right" });
  const startField = page.getByRole("spinbutton", {
    name: "Segment start seconds",
  });
  const current = Number(await startField.inputValue());
  await startField.fill((current + 0.02).toFixed(3));
  await page.getByRole("button", { name: "Apply trim" }).click();
  if (await page.locator(".error-banner").count())
    throw new Error(await page.locator(".error-banner").innerText());
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Close segment controls" }).click();
  if (await noticeDismiss.count()) await noticeDismiss.click();
  await page.locator(".editor-content").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: path.join(artifacts, "native-manual.png") });

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1024, 720);
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    )
    .toEqual({ width: 1024, height: 720 });
  const responsive = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".editor-content")!;
    const master = document.querySelector<HTMLElement>(".master-section")!;
    const masterTop = master.getBoundingClientRect().top;
    panel.scrollTop = panel.scrollHeight;
    const result = {
      width: innerWidth,
      height: innerHeight,
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      bodyOverflow: document.body.scrollWidth > innerWidth,
      panelScrolls: panel.scrollTop > 0,
      masterStaysVisible:
        Math.abs(master.getBoundingClientRect().top - masterTop) < 1 &&
        masterTop >= 0,
    };
    panel.scrollTop = 0;
    return result;
  });
  if (
    responsive.documentOverflow ||
    responsive.bodyOverflow ||
    !responsive.panelScrolls ||
    !responsive.masterStaysVisible
  )
    throw new Error(`Responsive layout failed: ${JSON.stringify(responsive)}`);
  const exportBox = await page
    .getByRole("button", { name: "Export master", exact: true })
    .boundingBox();
  if (
    !exportBox ||
    exportBox.x < 0 ||
    exportBox.y < 0 ||
    exportBox.x + exportBox.width > 1024 ||
    exportBox.y + exportBox.height > 720
  )
    throw new Error("Export is outside the minimum-size window.");
  await page.screenshot({
    path: path.join(artifacts, "native-responsive.png"),
  });

  const output = path.join(temporary, "UI narration.wav");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await page
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await page.getByRole("button", { name: /WAV audio/ }).click();
  await expect(page.getByText("Exported WAV.")).toBeVisible({
    timeout: 30_000,
  });
  const ffprobe = await findBinary("ffprobe");
  const probe = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_name,bits_per_raw_sample",
    "-of",
    "json",
    output,
  ]);
  const exported = JSON.parse(probe.stdout.toString());
  if (
    Number(exported.format.duration) < 5 ||
    exported.streams[0].bits_per_raw_sample !== "24"
  )
    throw new Error("UI exported an invalid master.");
  if (errors.length) throw new Error(errors.join("\n"));
  await page.waitForTimeout(250);
  const autosave = JSON.parse(
    await readFile(
      path.join(temporary, "profile/workspace-session.json"),
      "utf8",
    ),
  );
  if (autosave.projects[0].segments.length !== 10)
    throw new Error("Edited project was not autosaved.");
  await app.close();
  app = await electron.launch({
    args: [".", `--user-data-dir=${path.join(temporary, "profile")}`],
    cwd: root,
    chromiumSandbox: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  const restoredPage = await app.firstWindow();
  await expect(restoredPage.locator(".sentence-row")).toHaveCount(4);
  await restoredPage.getByRole("tab", { name: "Manual edit" }).click();
  await expect(restoredPage.locator(".source-segment")).toHaveCount(10);
  console.log(
    JSON.stringify(
      {
        demo: { tracks: 3, groups: 4 },
        choices: true,
        preview: true,
        masterPlayback: true,
        manualMuteUndoCutTrim: true,
        output: exported,
        autosave: true,
        coldRestart: true,
        responsive,
        screenshots: [
          "artifacts/native-choices.png",
          "artifacts/native-manual.png",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  const page = await app.firstWindow();
  console.error(
    "UI diagnostics:",
    await page
      .locator(".error-banner,.workspace-save-error,.progress-banner")
      .allTextContents(),
  );
  await page.screenshot({
    path: path.join(artifacts, "native-ui-failure.png"),
  });
  throw error;
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
