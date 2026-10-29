/** Opt-in live desktop check. Reads the authorized account key in memory; never prints it. */
import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
} from "@playwright/test";
import { readFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, runProcess } from "../electron/media";
import type { WorkspaceSession } from "../src/shared/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuration = process.env.EPIDEMIC_SOUND_MCP_API_KEY
  ? ""
  : await readFile(path.join(os.homedir(), ".codex/config.toml"), "utf8");
const section =
  /^\[mcp_servers\.epidemic-sound\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(
    configuration,
  )?.[1];
const key =
  process.env.EPIDEMIC_SOUND_MCP_API_KEY ??
  (section && /Authorization\s*=\s*"Bearer ([^"\r\n]+)"/i.exec(section)?.[1]);
if (!key)
  throw new Error(
    "Configure an account MCP key before this opt-in integration check.",
  );
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "mixstudio-epidemic-ui-"),
);
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
let page: Page;
const redact = (value: string) => value.split(key).join("[redacted]");
const savedWorkspace = async () =>
  JSON.parse(
    await readFile(path.join(profile, "workspace-session.json"), "utf8"),
  ) as WorkspaceSession;
async function enterPrivateKey(value: string) {
  await expect(
    page.getByLabel("Epidemic Sound API key", { exact: true }),
  ).toBeVisible();
  // Avoid locator.fill(secret), whose automatic failure diagnostics can echo values.
  await page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>("#epidemic-api-key");
    if (!input) throw new Error("The connection field is unavailable.");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function waitCatalog(browser: Locator) {
  await expect(browser.locator(".epidemic-results-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 60_000 },
  );
  await expect(browser.locator(".epidemic-result").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(browser.locator(".epidemic-error")).toHaveCount(0);
}
async function openBrowser(lane: string) {
  await page
    .getByRole("button", { name: `Add audio to ${lane}`, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: /^Add (music|a sound effect)$/ })
    .getByRole("button", { name: /Epidemic Sound/ })
    .click();
  return page.getByRole("dialog", { name: "Epidemic Sound", exact: true });
}
async function chooseFilter(browser: Locator, group: string, label: string) {
  const picker = browser
    .locator(".epidemic-filter-picker")
    .filter({
      has: page.locator("summary").filter({ hasText: new RegExp(`^${group}`) }),
    })
    .first();
  if ((await picker.getAttribute("open")) === null)
    await picker.locator("summary").click();
  await picker
    .getByRole("textbox", { name: `Find ${group.toLowerCase()}`, exact: true })
    .fill(label);
  await picker.getByRole("checkbox", { name: label, exact: true }).check();
  await waitCatalog(browser);
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(redact(error.message)));
  // Empty projects still require a real first narration before catalog imports.
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add audio to Music 1", exact: true })
    .click();
  const emptyChoice = page.getByRole("dialog", {
    name: "Add music",
    exact: true,
  });
  await expect(
    emptyChoice.getByRole("button", { name: /Epidemic Sound/ }),
  ).toBeDisabled();
  await emptyChoice
    .getByRole("button", { name: "Close audio source chooser" })
    .click();
  await page.getByRole("button", { name: "Quick guide", exact: true }).click();
  await page
    .getByRole("button", { name: "Let’s make a mix", exact: true })
    .click();
  await expect(page.locator(".sentence-row")).toHaveCount(4, {
    timeout: 90_000,
  });
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  let browser = await openBrowser("Music 1");
  await browser.getByRole("button", { name: /I have an API key/ }).click();
  await enterPrivateKey("invalid-epidemic-test-credential");
  await browser
    .getByRole("button", { name: "Verify and save key", exact: true })
    .click();
  await expect(browser.getByRole("alert")).toBeVisible({ timeout: 60_000 });
  if ((await page.evaluate(() => window.studio.epidemicStatus())).connected)
    throw new Error("An invalid key was accepted.");
  await enterPrivateKey(key);
  await browser
    .getByRole("button", { name: "Verify and save key", exact: true })
    .click();
  await expect(
    browser.getByText("Verifying your key with Epidemic Sound…", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    browser.getByText("API key verified", { exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  const connection = await page.evaluate(() => window.studio.epidemicStatus());
  if (!connection.connected || !connection.secureStorage)
    throw new Error(
      "The real account was not verified with secure macOS storage.",
    );
  const credentialFile = path.join(profile, "epidemic-credentials.json");
  const encrypted = await readFile(credentialFile);
  if (encrypted.toString().includes(key))
    throw new Error("Credentials were stored without encryption.");
  if (((await stat(credentialFile)).mode & 0o077) !== 0)
    throw new Error("The credential file permissions are too broad.");
  await browser.getByRole("button", { name: "Continue", exact: true }).click();
  await waitCatalog(browser);
  const catalog = await page.evaluate(() => window.studio.epidemicCatalog());
  if (
    catalog.genres.length < 390 ||
    catalog.moods.length < 30 ||
    catalog.soundEffects.length < 770 ||
    (catalog.musicalKeys?.length ?? 0) !== 24
  )
    throw new Error("The official category choices were incomplete.");
  await expect(browser.locator(".epidemic-theme")).toHaveCount(8);
  const initialRows = await browser.locator(".epidemic-result").count();
  const more = browser.getByRole("button", { name: /Load more/ });
  await more.click();
  await expect
    .poll(() => browser.locator(".epidemic-result").count(), {
      timeout: 60_000,
    })
    .toBeGreaterThan(initialRows);
  await chooseFilter(browser, "Genre", "Cinematic");
  await browser
    .getByRole("spinbutton", { name: "Maximum duration", exact: true })
    .fill("30");
  await waitCatalog(browser);
  await browser
    .getByRole("combobox", { name: "Vocal filter", exact: true })
    .selectOption("instrumental");
  await waitCatalog(browser);
  const musicRow = browser.locator(".epidemic-result").first();
  const musicTitle = await musicRow
    .locator(".epidemic-result-info > strong")
    .innerText();
  await musicRow
    .getByRole("button", { name: `Preview ${musicTitle}`, exact: true })
    .click();
  await expect(
    browser.getByRole("button", { name: "Pause catalog preview", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      () =>
        browser
          .locator("audio")
          .evaluate((element: HTMLAudioElement) => element.currentTime),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.3);
  await browser
    .getByRole("combobox", { name: "Catalog preview speed", exact: true })
    .selectOption("2");
  await browser
    .getByRole("button", {
      name: "Catalog preview forward 5 seconds",
      exact: true,
    })
    .click();
  await browser
    .getByRole("button", {
      name: "Catalog preview back 5 seconds",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const artwork = await browser
    .locator(".epidemic-cover img")
    .evaluateAll((images) => ({
      total: images.length,
      loaded: images.filter(
        (image) => (image as HTMLImageElement).naturalWidth > 0,
      ).length,
    }));
  console.log(JSON.stringify({ stage: "catalog preview verified", artwork }));
  await page.screenshot({
    path: path.join(artifacts, "epidemic-music-browser.png"),
  });
  await musicRow
    .getByRole("button", { name: `Find similar to ${musicTitle}`, exact: true })
    .click();
  await waitCatalog(browser);
  await expect(browser.locator(".epidemic-results-heading h3")).toContainText(
    "Similar to",
  );
  await browser.getByRole("button", { name: "Reset", exact: true }).click();
  await waitCatalog(browser);
  // Import a complete, high-quality recording, not its audition MP3.
  await chooseFilter(browser, "Genre", "Cinematic");
  await browser
    .getByRole("spinbutton", { name: "Maximum duration", exact: true })
    .fill("30");
  await waitCatalog(browser);
  const chosenMusic = browser.locator(".epidemic-result").first();
  const chosenTitle = await chosenMusic
    .locator(".epidemic-result-info > strong")
    .innerText();
  await browser
    .getByRole("combobox", { name: "Epidemic import format", exact: true })
    .selectOption("WAV");
  await chosenMusic
    .getByRole("button", { name: `Add ${chosenTitle} to mix`, exact: true })
    .click();
  const classifier = page.getByRole("dialog", {
    name: "What are we listening to?",
    exact: true,
  });
  await expect(classifier).toBeVisible({ timeout: 180_000 });
  await expect(
    classifier.getByRole("radio", { name: /^Music/ }),
  ).toHaveAttribute("aria-checked", "true");
  await classifier
    .getByRole("button", { name: "Add music", exact: true })
    .click();
  let arranger = page.getByRole("dialog", { name: "Music 1", exact: true });
  await expect(arranger).toBeVisible();
  await expect(arranger.locator(".placement-clip")).toHaveCount(1);
  await arranger
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  await expect(page.locator(".music-lane-music .placement-clip")).toHaveCount(
    1,
  );
  // Effects use the same browser and the same downstream import flow.
  browser = await openBrowser("Soundtrack 1");
  await waitCatalog(browser);
  await chooseFilter(browser, "Category", "Swooshes / Whoosh");
  await browser
    .getByRole("textbox", { name: "Search Epidemic Sound", exact: true })
    .fill("soft whoosh");
  await browser.getByRole("button", { name: "Search", exact: true }).click();
  await browser
    .getByRole("spinbutton", { name: "Maximum duration", exact: true })
    .fill("5");
  await waitCatalog(browser);
  const effect = browser.locator(".epidemic-result").first();
  const effectTitle = await effect
    .locator(".epidemic-result-info > strong")
    .innerText();
  await effect
    .getByRole("button", { name: `Preview ${effectTitle}`, exact: true })
    .click();
  await expect(
    browser.getByRole("button", { name: "Pause catalog preview", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const previewUrl = await browser.locator("audio").getAttribute("src");
  if (!previewUrl?.startsWith("mixmedia://audio/"))
    throw new Error("Catalog previews bypassed the production media protocol.");
  const range = await app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url, { headers: { Range: "bytes=0-63" } });
    return {
      status: response.status,
      bytes: (await response.arrayBuffer()).byteLength,
    };
  }, previewUrl);
  if (range.status !== 206 || range.bytes !== 64)
    throw new Error("Catalog previews failed production byte ranges.");
  await page.screenshot({
    path: path.join(artifacts, "epidemic-sound-effects-browser.png"),
  });
  await browser
    .getByRole("combobox", { name: "Epidemic import format", exact: true })
    .selectOption("MP3");
  await effect
    .getByRole("button", { name: `Add ${effectTitle} to mix`, exact: true })
    .click();
  await expect(classifier).toBeVisible({ timeout: 180_000 });
  await expect(
    classifier.getByRole("radio", { name: /^Sound effect/ }),
  ).toHaveAttribute("aria-checked", "true");
  await classifier
    .getByRole("button", { name: "Add sound effect", exact: true })
    .click();
  arranger = page.getByRole("dialog", { name: "Soundtrack 1", exact: true });
  await expect(arranger.locator(".placement-clip")).toHaveCount(1);
  await arranger
    .getByRole("button", { name: "Save arrangement", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await savedWorkspace()).projects[0].tracks.filter(
          (track) => track.origin?.provider === "epidemic-sound",
        ).length,
    )
    .toBe(2);
  const project = (await savedWorkspace()).projects[0];
  if (
    project.soundMix?.placements.length !== 2 ||
    project.tracks
      .filter((track) => track.origin)
      .some((track) => !track.origin?.id || !track.origin.format)
  )
    throw new Error("Catalog source provenance or placements did not persist.");
  const workspaceBytes = await readFile(
    path.join(profile, "workspace-session.json"),
    "utf8",
  );
  if (
    workspaceBytes.includes(key) ||
    workspaceBytes.includes("X-Amz-Signature") ||
    workspaceBytes.includes("Authorization")
  )
    throw new Error("Private credentials leaked into workspace data.");
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await expect
    .poll(
      async () =>
        Number(
          await page
            .getByRole("slider", { name: "Seek master track", exact: true })
            .inputValue(),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  const output = path.join(temporary, "epidemic-mix.wav");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await page
    .getByRole("button", { name: "Export master", exact: true })
    .click();
  await page.getByRole("button", { name: /WAV audio/ }).click();
  await expect(page.getByText("Exported WAV.", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  const outputProbe = await runProcess(await findBinary("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    output,
  ]);
  const duration = Number(
    JSON.parse(outputProbe.stdout.toString()).format.duration,
  );
  if (duration < 20)
    throw new Error("The exported master lost its full-quality music layer.");
  // Invalid replacement keeps the previous encrypted connection intact.
  await page
    .getByRole("button", { name: "Studio settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Studio settings",
    exact: true,
  });
  await settings
    .getByRole("button", { name: "Replace API key", exact: true })
    .click();
  await enterPrivateKey("invalid-replacement-credential");
  await settings
    .getByRole("button", { name: "Verify and save key", exact: true })
    .click();
  await expect(settings.locator(".epidemic-error")).toBeVisible({
    timeout: 60_000,
  });
  if (!(await page.evaluate(() => window.studio.epidemicStatus())).connected)
    throw new Error("An invalid replacement removed the working connection.");
  if (!(await readFile(credentialFile)).equals(encrypted))
    throw new Error("A rejected key changed the saved credential.");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await settings
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator(".sentence-row")).toHaveCount(4);
  if (!(await page.evaluate(() => window.studio.epidemicStatus())).connected)
    throw new Error("The encrypted connection did not recover after restart.");
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  await expect(page.locator(".music-lane-music .placement-clip")).toHaveCount(
    1,
  );
  await expect(
    page.locator(".music-lane-soundtrack .placement-clip"),
  ).toHaveCount(1);
  browser = await openBrowser("Music 1");
  await waitCatalog(browser);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1024, 720),
  );
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("The catalog overflowed the minimum-size desktop window.");
  await page.screenshot({
    path: path.join(artifacts, "epidemic-browser-small.png"),
  });
  await browser
    .getByRole("button", { name: "Close Epidemic Sound browser", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Studio settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove saved key", exact: true })
    .click();
  if ((await page.evaluate(() => window.studio.epidemicStatus())).connected)
    throw new Error("Removing the account connection failed.");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        realKeyVerified: true,
        invalidKeyRejected: true,
        encryptedStorage: true,
        invalidReplacementPreservesKey: true,
        officialCategories: {
          genres: catalog.genres.length,
          moods: catalog.moods.length,
          effects: catalog.soundEffects.length,
        },
        realSearchPaginationAndFilters: true,
        similarMusic: true,
        inlinePreviewAndSeek: true,
        productionMediaRanges: range,
        highQualityMusicWavAndEffectMp3: true,
        sharedClassificationAndArrangement: true,
        fullMixDuration: duration,
        restart: true,
        minimumWindow: true,
        removeConnection: true,
      },
      null,
      2,
    ),
  );
} catch (failure) {
  if (page!)
    await page
      .screenshot({ path: path.join(artifacts, "epidemic-failure.png") })
      .catch(() => undefined);
  const message = redact(
    failure instanceof Error ? failure.message : String(failure),
  );
  console.error("Epidemic desktop check:", message);
  throw new Error(message);
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
