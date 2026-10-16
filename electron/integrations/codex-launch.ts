// Finder-safe Node launcher adapted from Vandashi (MIT), copyright (c) 2026 Igor.
// See resources/transcription/VANDASHI-LICENSE.txt for the full license notice.
import { closeSync, openSync, readSync } from "node:fs";
import { delimiter, dirname, isAbsolute } from "node:path";
import { runProcess } from "./process";

// Electron supplies Node even when Finder's PATH cannot resolve npm's Node binary.
// The switch belongs only to this bootstrap and must not reach Codex or its tools.
const bootstrap = `delete process.env.ELECTRON_RUN_AS_NODE;
const { pathToFileURL } = await import('node:url');
await import(pathToFileURL(process.argv[1]).href);`;

function usesNode(binary: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(binary, "r");
    const header = Buffer.alloc(512);
    const length = readSync(descriptor, header, 0, header.length, 0);
    return /^#![^\r\n]*(?:\/|\s)node(?:\s|$)/u.test(
      header.toString("utf8", 0, length).split("\n")[0] ?? "",
    );
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export interface CodexLaunch {
  command: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
}

export function codexLaunch(
  binary: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  nodePath = process.execPath,
): CodexLaunch {
  const existing = (environment.PATH ?? "").split(delimiter).filter(Boolean);
  const extra =
    process.platform === "win32"
      ? []
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const env = {
    ...environment,
    PATH: [
      ...new Set([
        ...existing,
        ...(isAbsolute(binary) ? [dirname(binary)] : []),
        ...extra,
      ]),
    ].join(delimiter),
  };
  if (!usesNode(binary)) return { command: binary, args, environment: env };
  return {
    command: nodePath,
    args: ["--input-type=module", "--eval", bootstrap, binary, ...args],
    environment: { ...env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

/** Both health checks and background analysis use this same Finder-safe launch. */
export function runCodex(
  binary: string,
  args: string[],
  options: Parameters<typeof runProcess>[2],
): Promise<string> {
  const launch = codexLaunch(binary, args, options.env);
  return runProcess(launch.command, launch.args, {
    ...options,
    env: launch.environment,
  });
}
