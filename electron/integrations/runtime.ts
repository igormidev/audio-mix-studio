// Managed private runtime bootstrap adapted from Vandashi (MIT).
// Copyright (c) 2026 Igor. See resources/transcription/VANDASHI-LICENSE.txt.
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  OperationProgress,
  TranscriptionModel,
} from "../../src/shared/types";
import { digest, downloadFile, verifiedFile, wheelExecutable } from "./files";
import type { DownloadRecord } from "./files";
import { runProcess } from "./process";

export type Progress = (progress: OperationProgress) => void;
interface ModelRecord {
  revision: string;
  files: (DownloadRecord & { path: string })[];
}
interface ModelManifest {
  asr: Record<TranscriptionModel, ModelRecord>;
}
interface UvManifest {
  version: string;
  platforms: Record<
    string,
    DownloadRecord & { entry: string; executableSha256: string }
  >;
}
const runtimeChecks = new Set<string>();
const healthCheck =
  'import whisperx,ctranslate2,torch,ai_edge_litert,silero_vad;from importlib.metadata import version;assert version("whisperx")=="3.8.6";print("ready")';

export async function resourcesDirectory(): Promise<string> {
  // Electron bundles main as CJS; tsx-based integration checks run as ESM.
  const moduleDirectory =
    typeof __dirname === "string" ? __dirname : process.cwd();
  const packagedResources = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    ...(process.env.AUDIO_MIX_TRANSCRIPTION_RESOURCES
      ? [process.env.AUDIO_MIX_TRANSCRIPTION_RESOURCES]
      : []),
    ...(packagedResources ? [join(packagedResources, "transcription")] : []),
    join(moduleDirectory, "../../resources/transcription"),
    join(moduleDirectory, "../resources/transcription"),
    join(process.cwd(), "resources/transcription"),
  ];
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "worker.py"));
      return candidate;
    } catch {
      /* Try next bundled location. */
    }
  }
  throw new Error(
    "The bundled WhisperX worker is missing. Reinstall Audio Mix Studio.",
  );
}

export function externalRuntime(): string {
  return join(homedir(), "Library/Application Support/vandashi/transcription");
}

export async function findExecutable(
  name: "codex" | "ffmpeg" | "soundstretch",
): Promise<string | undefined> {
  const override =
    process.env[
      name === "codex"
        ? "AUDIO_MIX_CODEX_PATH"
        : name === "soundstretch"
          ? "AUDIO_MIX_SOUNDTOUCH_PATH"
          : "AUDIO_MIX_FFMPEG_PATH"
    ];
  const directories = [
    ...(process.env.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local/bin"),
    join(homedir(), ".cargo/bin"),
  ];
  for (const candidate of [
    ...(override ? [override] : []),
    ...directories.filter(Boolean).map((directory) => join(directory, name)),
  ]) {
    try {
      await access(candidate, constants.X_OK);
      if ((await lstat(candidate)).isDirectory()) continue;
      return candidate;
    } catch {
      /* Finder often has a minimal PATH. */
    }
  }
  return undefined;
}

export function privateEnvironment(directory: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(PYTHONPATH|PYTHONHOME|VIRTUAL_ENV|UV_INDEX|UV_EXTRA_INDEX|UV_DEFAULT_INDEX|UV_FIND_LINKS|PIP_)/.test(
          key,
        ),
    ),
  );
  return {
    ...environment,
    UV_PYTHON_INSTALL_DIR: join(directory, "python"),
    UV_CACHE_DIR: join(directory, "uv-cache"),
    UV_NO_MODIFY_PATH: "1",
    UV_PYTHON_INSTALL_BIN: "false",
    HF_HUB_DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HF_HOME: join(directory, "hf-cache"),
    TORCH_HOME: join(directory, "torch-cache"),
    XDG_CACHE_HOME: join(directory, "cache"),
  };
}

async function runtimeValid(
  directory: string,
  signal: AbortSignal,
): Promise<boolean> {
  const python = join(directory, "environment/bin/python");
  try {
    await access(python, constants.X_OK);
    const resources = await resourcesDirectory();
    const revision = createHash("sha256")
      .update(await readFile(join(resources, "macos-arm64.txt")))
      .digest("hex");
    let marker: string;
    try {
      marker = await readFile(
        join(directory, "environment/.audio-mix-runtime"),
        "utf8",
      );
    } catch {
      marker = await readFile(
        join(directory, "environment/.vandashi-runtime"),
        "utf8",
      );
    }
    if (marker !== revision) return false;
    const info = await lstat(python);
    const key = `${python}:${info.mtimeMs}:${marker}`;
    if (runtimeChecks.has(key)) return true;
    const output = await runProcess(
      python,
      ["-B", "-s", "-E", "-c", healthCheck],
      {
        signal,
        env: privateEnvironment(join(tmpdir(), "audio-mix-health")),
        timeoutMs: 90_000,
      },
    );
    const valid = output.trim() === "ready";
    if (valid) runtimeChecks.add(key);
    signal.throwIfAborted();
    return valid;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

export async function findRuntime(
  directory: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  for (const root of [directory, externalRuntime()]) {
    if (await runtimeValid(root, signal))
      return join(root, "environment/bin/python");
  }
  return undefined;
}

export async function downloadedModels(
  directory: string,
  signal: AbortSignal,
): Promise<{ id: TranscriptionModel; downloaded: boolean }[]> {
  const manifest = JSON.parse(
    await readFile(join(await resourcesDirectory(), "models.json"), "utf8"),
  ) as ModelManifest;
  return Promise.all(
    Object.entries(manifest.asr).map(async ([name, model]) => {
      for (const root of [directory, externalRuntime()]) {
        let complete = true;
        for (const file of model.files) {
          if (
            !(await verifiedFile(
              join(root, "models/asr", name, model.revision, file.path),
              file,
              signal,
            ))
          ) {
            complete = false;
            break;
          }
        }
        if (complete)
          return { id: name as TranscriptionModel, downloaded: true };
      }
      return { id: name as TranscriptionModel, downloaded: false };
    }),
  );
}

export async function ensureRuntime(
  directory: string,
  progress: Progress,
  signal: AbortSignal,
): Promise<string> {
  const existing = await findRuntime(directory, signal);
  if (existing) return existing;
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "This release supports WhisperX setup on Apple Silicon Macs. Use a Mac with an M-series chip.",
    );
  const resources = await resourcesDirectory();
  const manifest = JSON.parse(
    await readFile(join(resources, "uv.json"), "utf8"),
  ) as UvManifest;
  const record = manifest.platforms["darwin-arm64"];
  if (!record)
    throw new Error("The bundled Python installer manifest is incomplete.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, `uv-${manifest.version}`);
  let uvReady = false;
  try {
    uvReady = (await digest(binary, signal)) === record.executableSha256;
  } catch {
    signal.throwIfAborted();
  }
  if (!uvReady) {
    progress({
      phase: "installing",
      message: "Downloading the private Python installer…",
    });
    const archive = join(directory, `uv-${manifest.version}.whl`);
    await downloadFile(archive, record, signal, (fraction) =>
      progress({
        phase: "installing",
        message: "Downloading the private Python installer…",
        fraction,
      }),
    );
    const executable = wheelExecutable(await readFile(archive), record.entry);
    if (
      createHash("sha256").update(executable).digest("hex") !==
      record.executableSha256
    )
      throw new Error("The Python installer failed its integrity check.");
    const partial = `${binary}.${randomUUID()}.partial`;
    try {
      await writeFile(partial, executable, { flag: "wx", mode: 0o700 });
      await chmod(partial, 0o700);
      await rename(partial, binary);
    } finally {
      await rm(partial, { force: true });
    }
    await rm(archive, { force: true });
  }
  const environment = join(directory, "environment");
  const python = join(environment, "bin/python");
  const env = privateEnvironment(directory);
  try {
    await access(python);
  } catch {
    progress({
      phase: "installing",
      message: "Installing private Python 3.11.15…",
    });
    await runProcess(
      binary,
      [
        "--no-config",
        "venv",
        "--python",
        "3.11.15",
        "--managed-python",
        environment,
      ],
      { signal, env },
    );
  }
  progress({
    phase: "installing",
    message:
      "Installing WhisperX and its pinned dependencies. First setup can take several minutes…",
  });
  let lastLine = 0;
  await runProcess(
    binary,
    [
      "--no-config",
      "pip",
      "sync",
      "--python",
      python,
      "--require-hashes",
      "--only-binary",
      ":all:",
      "--no-binary",
      "antlr4-python3-runtime",
      "--build-constraints",
      join(resources, "build-constraints.txt"),
      join(resources, "macos-arm64.txt"),
    ],
    {
      signal,
      env,
      onLine: () => {
        if (Date.now() - lastLine > 2_000) {
          lastLine = Date.now();
          progress({
            phase: "installing",
            message: "Installing WhisperX dependencies…",
          });
        }
      },
    },
  );
  await runProcess(python, ["-B", "-s", "-E", "-c", healthCheck], {
    signal,
    env,
    timeoutMs: 90_000,
  });
  const revision = createHash("sha256")
    .update(await readFile(join(resources, "macos-arm64.txt")))
    .digest("hex");
  await writeFile(join(environment, ".audio-mix-runtime"), revision, {
    mode: 0o600,
  });
  return python;
}

/** Only this application's cache is ever locked or changed. Vandashi stays read-only. */
export async function withRuntimeLock<T>(
  directory: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "runtime.lock");
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const deadline = Date.now() + 30_000;
  for (;;) {
    signal.throwIfAborted();
    try {
      const handle = await open(lock, "wx", 0o600);
      try {
        await handle.writeFile(owner);
        await handle.sync();
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
      let saved = "";
      try {
        saved = await readFile(lock, "utf8");
        const record = JSON.parse(saved) as { pid?: unknown };
        if (
          typeof record.pid === "number" &&
          Number.isInteger(record.pid) &&
          record.pid > 0
        ) {
          try {
            process.kill(record.pid, 0);
          } catch (cause) {
            if (
              cause instanceof Error &&
              "code" in cause &&
              cause.code === "ESRCH" &&
              (await readFile(lock, "utf8")) === saved
            ) {
              await rm(lock);
              continue;
            }
          }
        }
      } catch {
        /* An active process may still be writing its lock. */
      }
      if (Date.now() > deadline)
        throw new Error(
          "WhisperX is busy in another Audio Mix Studio window. Please try again shortly.",
        );
      await delay(250, undefined, { signal });
    }
  }
  try {
    return await work();
  } finally {
    try {
      if ((await readFile(lock, "utf8")) === owner) await rm(lock);
    } catch {
      /* Preserve another owner. */
    }
  }
}

export async function workerRequest(
  python: string,
  directory: string,
  payload: Record<string, unknown>,
  progress: Progress,
  signal: AbortSignal,
): Promise<unknown> {
  const temporary = await mkdtemp(join(tmpdir(), "audio-mix-whisperx-"));
  let result: unknown;
  let completed = false;
  try {
    const request = join(temporary, "request.json");
    await writeFile(
      request,
      JSON.stringify({
        ...payload,
        cache: join(directory, "models"),
        fallbackCache: join(externalRuntime(), "models"),
      }),
      { mode: 0o600 },
    );
    await runProcess(
      python,
      [
        "-B",
        "-s",
        "-E",
        join(await resourcesDirectory(), "worker.py"),
        request,
      ],
      {
        signal,
        env: privateEnvironment(directory),
        onLine: (line) => {
          const event = JSON.parse(line) as {
            type?: string;
            phase?: string;
            fraction?: number;
            value?: unknown;
          };
          if (event.type === "progress") {
            const phase =
              event.phase === "model-download"
                ? "downloading"
                : event.phase === "aligning"
                  ? "aligning"
                  : "transcribing";
            const message =
              phase === "downloading"
                ? "Downloading and verifying speech model…"
                : phase === "aligning"
                  ? "Aligning word timestamps…"
                  : "Transcribing locally with WhisperX…";
            progress({
              phase,
              message,
              ...(typeof event.fraction === "number" &&
              Number.isFinite(event.fraction)
                ? { fraction: Math.max(0, Math.min(1, event.fraction)) }
                : {}),
            });
          } else if (event.type === "ready" || event.type === "result") {
            if (completed)
              throw new Error("WhisperX returned a duplicate result.");
            completed = true;
            result = event.value;
          } else throw new Error("WhisperX returned an invalid response.");
        },
      },
    );
    if (!completed)
      throw new Error("WhisperX stopped without producing a result.");
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
