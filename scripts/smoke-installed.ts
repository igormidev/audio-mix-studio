import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const executable =
  process.argv[2] ??
  "/Applications/Audio Mix Studio.app/Contents/MacOS/Audio Mix Studio";
const expectedVersion: string = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;
const temporary = await mkdtemp(path.join(tmpdir(), "mixstudio-installed-"));
const environment = { ...process.env, PATH: "/usr/bin:/bin" };
delete environment.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: executable,
  args: [`--user-data-dir=${path.join(temporary, "profile")}`],
  cwd: temporary,
  chromiumSandbox: true,
  env: environment,
});
try {
  const page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "Import your audio", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("tab", { name: "Music & Sound Track", exact: true })
    .click();
  await expect(page.locator(".music-lane")).toHaveCount(3);
  await page
    .getByRole("tab", { name: "Sentence choices", exact: true })
    .click();
  const identity = await app.evaluate(({ app }) => ({
    executable: app.getPath("exe"),
    version: app.getVersion(),
    packaged: app.isPackaged,
  }));
  if (
    !identity.packaged ||
    identity.executable !== executable ||
    identity.version !== expectedVersion
  )
    throw new Error("Installed bundle identity did not match.");
  const status = await page.evaluate(() => window.studio.dependencies());
  if (
    !status.codex.available ||
    !status.ffmpeg.available ||
    !status.soundtouch?.available ||
    !status.whisperx.available ||
    !status.models.some((m) => m.id === "large-v3-turbo" && m.downloaded)
  )
    throw new Error(
      "Installed app could not find the actual tools/default model.",
    );
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
  await page
    .getByRole("button", { name: /^Edit voiceover speed:/ })
    .first()
    .click();
  const speed = page.getByRole("spinbutton", {
    name: "Playback speed value",
    exact: true,
  });
  await speed.fill("1.37");
  await speed.press("Enter");
  await expect(speed).toHaveValue("1.37");
  await page.getByRole("button", { name: "Play master", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Seek master track" }),
  ).not.toHaveValue("0", { timeout: 15_000 });
  await page.getByRole("button", { name: "Pause master", exact: true }).click();
  let epidemicVerified = false;
  if (process.env.AUDIO_MIX_TEST_EPIDEMIC === "1") {
    const configuration = await readFile(
      path.join(homedir(), ".codex/config.toml"),
      "utf8",
    );
    const section =
      /^\[mcp_servers\.epidemic-sound\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(
        configuration,
      )?.[1];
    const key =
      process.env.EPIDEMIC_SOUND_MCP_API_KEY ??
      (section &&
        /Authorization\s*=\s*"Bearer ([^"\r\n]+)"/i.exec(section)?.[1]);
    if (!key)
      throw new Error(
        "An account MCP key is required for the opt-in installed integration check.",
      );
    const account = await page.evaluate(
      (key) => window.studio.epidemicConnect(key, crypto.randomUUID()),
      key,
    );
    if (!account.connected || !account.secureStorage)
      throw new Error(
        "The installed app did not verify and encrypt its Epidemic connection.",
      );
    const results = await page.evaluate(() =>
      window.studio.epidemicSearch(
        { kind: "soundtrack", term: "soft whoosh", durationMax: 5, first: 1 },
        crypto.randomUUID(),
      ),
    );
    if (!results.items[0])
      throw new Error("The installed catalog search returned no audio.");
    const preview = await page.evaluate(
      (id) =>
        window.studio.epidemicPreview(
          { id, kind: "soundtrack" },
          crypto.randomUUID(),
        ),
      results.items[0].id,
    );
    const played = await page.evaluate(async (url) => {
      const audio = new Audio(url);
      await new Promise<void>((resolve, reject) => {
        audio.onloadedmetadata = () => resolve();
        audio.onerror = () =>
          reject(new Error("Installed preview could not load."));
      });
      await audio.play();
      await new Promise((resolve) => setTimeout(resolve, 350));
      audio.pause();
      return audio.currentTime;
    }, preview.mediaUrl);
    if (played < 0.1)
      throw new Error("The installed catalog preview did not play.");
    await page.evaluate(() => window.studio.epidemicDisconnect());
    epidemicVerified = true;
  }
  console.log(
    JSON.stringify(
      {
        ...identity,
        minimalFinderPATH: true,
        defaultModel: true,
        tools: true,
        soundtouch: true,
        pitchPreservingSpeed: 1.37,
        realDemoPlayback: true,
        ...(epidemicVerified ? { realEpidemicConnectionAndPreview: true } : {}),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
