import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
