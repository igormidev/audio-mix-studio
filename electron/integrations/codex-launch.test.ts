import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { codexLaunch, runCodex } from "./codex-launch";

describe("Finder-safe Codex launching", () => {
  it("runs a Node-shebang launcher without PATH Node and strips Electron's flag before descendants", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audio-mix-codex-launch-"));
    try {
      const launcher = join(directory, "codex launcher.mjs");
      await writeFile(
        launcher,
        `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
const child = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify({flag:process.env.ELECTRON_RUN_AS_NODE??null}))']).toString());
console.log(JSON.stringify({args:process.argv.slice(2),flag:process.env.ELECTRON_RUN_AS_NODE??null,childFlag:child.flag}));
`,
        { mode: 0o700 },
      );
      const original = {
        PATH: "/path-without-node",
        ELECTRON_RUN_AS_NODE: "existing-value",
      };
      const launch = codexLaunch(
        launcher,
        ["exec", "argument with spaces"],
        original,
      );
      expect(launch.command).toBe(process.execPath);
      expect(launch.environment.ELECTRON_RUN_AS_NODE).toBe("1");
      expect((launch.environment.PATH ?? "").split(delimiter)).toContain(
        directory,
      );
      const output = await runCodex(
        launcher,
        ["exec", "argument with spaces"],
        {
          signal: new AbortController().signal,
          env: original,
        },
      );
      expect(JSON.parse(output)).toEqual({
        args: ["exec", "argument with spaces"],
        flag: null,
        childFlag: null,
      });
      expect(original.ELECTRON_RUN_AS_NODE).toBe("existing-value");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a native executable direct and preserves argument boundaries", () => {
    const args = ["exec", "argument with spaces"];
    const launch = codexLaunch(process.execPath, args, { PATH: "/custom/bin" });
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toBe(args);
    expect(launch.environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect((launch.environment.PATH ?? "").split(delimiter)).toContain(
      dirname(process.execPath),
    );
  });
});
