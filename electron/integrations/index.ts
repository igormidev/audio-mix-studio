import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptionModels } from "../../src/shared/types";
import type {
  AlignmentResult,
  AudioTrack,
  CodexSelection,
  DependencyStatus,
  OperationProgress,
  TimedText,
  Transcript,
  TranscriptionModel,
} from "../../src/shared/types";
import { alignWithCodex } from "./alignment";
import { runCodex } from "./codex-launch";
export { discoverCodexModels } from "./codex-models";
import { digest } from "./files";
import { runProcess } from "./process";
import {
  downloadedModels,
  ensureRuntime,
  externalRuntime,
  findExecutable,
  findRuntime,
  privateEnvironment,
  withRuntimeLock,
  workerRequest,
} from "./runtime";
import {
  cacheTranscript,
  readCachedTranscript,
  transcriptCacheFile,
} from "./transcript-cache";

type Progress = (progress: OperationProgress) => void;

export async function checkDependencies(
  cacheDir: string,
  operationSignal?: AbortSignal,
): Promise<DependencyStatus> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(120_000),
    ...(operationSignal ? [operationSignal] : []),
  ]);
  const [codex, ffmpeg, python, models, soundtouch] = await Promise.all([
    findExecutable("codex"),
    findExecutable("ffmpeg"),
    findRuntime(cacheDir, signal),
    downloadedModels(cacheDir, signal),
    findExecutable("soundstretch"),
  ]);
  let codexDetail = "Install Codex CLI and sign in with “codex login”.";
  let codexReady = false;
  if (codex) {
    try {
      const version = (
        await runCodex(codex, ["--version"], { signal, timeoutMs: 15_000 })
      ).trim();
      const auth = await runCodex(codex, ["login", "status"], {
        signal,
        timeoutMs: 15_000,
      });
      codexReady = true;
      codexDetail = `${version}${auth.trim() ? ` · ${auth.trim()}` : " · Signed in"}`;
    } catch (error) {
      codexDetail = /not logged in|login|sign in|auth/i.test(
        error instanceof Error ? error.message : "",
      )
        ? "Codex is installed. Run “codex login” in Terminal to sign in."
        : "Codex was found but could not run. Update or reinstall Codex CLI.";
    }
  }
  let ffmpegReady = false;
  if (ffmpeg) {
    try {
      await runProcess(ffmpeg, ["-version"], { signal, timeoutMs: 15_000 });
      ffmpegReady = true;
    } catch {
      /* The settings UI exposes the install instructions. */
    }
  }
  let soundtouchReady = false;
  if (soundtouch) {
    try {
      await runProcess(soundtouch, ["-license"], { signal, timeoutMs: 15_000 });
      soundtouchReady = true;
    } catch (error) {
      // SoundStretch 2.4.1 intentionally returns 255 after printing -license.
      // Recognize its complete response while still rejecting launch failures,
      // timeouts, and broken executables.
      const output = error instanceof Error ? error.message : "";
      soundtouchReady =
        /\bSoundStretch v\d+\.\d+/u.test(output) &&
        /LICENSE:/u.test(output) &&
        /SoundTouch sound processing library/u.test(output);
    }
  }
  signal.throwIfAborted();
  return {
    soundtouch: {
      available: soundtouchReady,
      ...(soundtouch ? { path: soundtouch } : {}),
      detail: soundtouchReady
        ? "SoundTouch · Audacity-style pitch-preserving tempo ready."
        : "Install SoundTouch with “brew install sound-touch” for pitch-preserving speed.",
    },
    codex: {
      available: codexReady,
      ...(codex ? { path: codex } : {}),
      detail: codexDetail,
    },
    ffmpeg: {
      available: ffmpegReady,
      ...(ffmpeg ? { path: ffmpeg } : {}),
      detail: ffmpegReady
        ? "Ready for local audio decoding and export."
        : "Install FFmpeg with “brew install ffmpeg”.",
    },
    whisperx: {
      available: !!python,
      ...(python ? { path: python } : {}),
      detail: python
        ? python.startsWith(externalRuntime())
          ? "WhisperX 3.8.6 · Reusing the verified Vandashi environment."
          : "WhisperX 3.8.6 · Private local environment ready."
        : process.platform === "darwin" && process.arch === "arm64"
          ? "Set up local transcription to install a private WhisperX environment."
          : "Local transcription currently requires an Apple Silicon Mac.",
    },
    models,
  };
}

function assertModel(model: TranscriptionModel): void {
  if (!transcriptionModels.includes(model))
    throw new Error("Choose a supported transcription model.");
}

export async function setupTranscription(
  cacheDir: string,
  model: TranscriptionModel,
  onProgress: Progress,
  signal: AbortSignal,
): Promise<DependencyStatus> {
  assertModel(model);
  await withRuntimeLock(cacheDir, signal, async () => {
    const python = await ensureRuntime(cacheDir, onProgress, signal);
    onProgress({
      phase: "downloading",
      message: `Preparing ${model}. A new model may require a large download…`,
    });
    await workerRequest(
      python,
      cacheDir,
      { op: "prepare", model },
      onProgress,
      signal,
    );
  });
  signal.throwIfAborted();
  return checkDependencies(cacheDir, signal);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function timedText(value: unknown, duration: number): TimedText[] {
  if (!Array.isArray(value) || value.length > 2_000_000)
    throw new Error("WhisperX returned an invalid transcript.");
  let previous = -1;
  return value.map((unit) => {
    if (
      !record(unit) ||
      typeof unit.start !== "number" ||
      typeof unit.end !== "number" ||
      typeof unit.text !== "string" ||
      !unit.text.trim() ||
      !Number.isFinite(unit.start) ||
      !Number.isFinite(unit.end) ||
      unit.start < 0 ||
      unit.end < unit.start ||
      unit.end > duration + 0.15 ||
      unit.start < previous
    )
      throw new Error("WhisperX returned invalid transcript timing.");
    previous = unit.start;
    return {
      start: Math.min(duration, unit.start),
      end: Math.min(duration, unit.end),
      text: unit.text.trim(),
    };
  });
}

function parseTranscript(
  value: unknown,
  duration: number,
  model: TranscriptionModel,
): Transcript {
  if (
    !record(value) ||
    value.model !== model ||
    !(value.language === null || typeof value.language === "string")
  )
    throw new Error("WhisperX did not complete the selected transcription.");
  return {
    model,
    language: value.language,
    segments: timedText(value.segments, duration),
    words: timedText(value.words, duration),
  };
}

export async function transcribe(
  track: AudioTrack,
  audioPath: string,
  cacheDir: string,
  model: TranscriptionModel,
  onProgress: Progress,
  signal: AbortSignal,
): Promise<Transcript> {
  assertModel(model);
  if (!Number.isFinite(track.duration) || track.duration <= 0)
    throw new Error("The recording has no playable audio.");
  const ffmpeg = await findExecutable("ffmpeg");
  if (!ffmpeg)
    throw new Error(
      "FFmpeg is not installed. Run “brew install ffmpeg” in Terminal, then try again.",
    );
  const original = await lstat(audioPath);
  if (!original.isFile())
    throw new Error("The source recording is unavailable. Import it again.");
  const sourceHash = await digest(audioPath, signal);
  const report: Progress = (progress) =>
    onProgress({ ...progress, trackId: track.id });
  const cacheFile = await transcriptCacheFile(cacheDir, sourceHash, model);
  const cached = await readCachedTranscript(
    cacheFile,
    track.duration,
    (value) => parseTranscript(value, track.duration, model),
  );
  signal.throwIfAborted();
  if (cached) {
    const current = await lstat(audioPath);
    if (
      original.dev !== current.dev ||
      original.ino !== current.ino ||
      original.size !== current.size ||
      original.mtimeMs !== current.mtimeMs ||
      original.ctimeMs !== current.ctimeMs
    )
      throw new Error(
        "The recording changed while reading its transcript. Import the updated file and try again.",
      );
    report({
      phase: "transcribing",
      message: `Using the saved transcript for ${track.name}…`,
      fraction: 1,
    });
    return cached;
  }
  return withRuntimeLock(cacheDir, signal, async () => {
    // Analyze also prepares a missing selected model. Setup never needs a separate user step.
    const python = await ensureRuntime(cacheDir, report, signal);
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(tmpdir(), "audio-mix-decode-"));
    try {
      report({ phase: "transcribing", message: `Decoding ${track.name}…` });
      const pcmPath = join(temporary, "audio.pcm");
      await runProcess(
        ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          "-i",
          audioPath,
          "-map",
          "0:a:0",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "f32le",
          pcmPath,
        ],
        { signal, env: privateEnvironment(cacheDir) },
      );
      if ((await lstat(pcmPath)).size < 4)
        throw new Error("The recording has no decodable audio.");
      const value = await workerRequest(
        python,
        cacheDir,
        {
          op: "analyze",
          model,
          pcmPath,
          kind: "audio",
          category: "dialog",
          sourceHash,
        },
        report,
        signal,
      );
      if (
        !record(value) ||
        value.sourceHash !== sourceHash ||
        !record(value.transcription)
      )
        throw new Error("WhisperX did not return a valid transcript.");
      const result = value.transcription;
      if (result.status !== "complete")
        throw new Error(
          "WhisperX did not complete the selected transcription.",
        );
      const current = await lstat(audioPath);
      if (
        original.dev !== current.dev ||
        original.ino !== current.ino ||
        original.size !== current.size ||
        original.mtimeMs !== current.mtimeMs ||
        original.ctimeMs !== current.ctimeMs ||
        (await digest(audioPath, signal)) !== sourceHash
      )
        throw new Error(
          "The recording changed during transcription. Import the updated file and try again.",
        );
      const transcript = parseTranscript(result, track.duration, model);
      signal.throwIfAborted();
      await cacheTranscript(cacheFile, track.duration, transcript);
      signal.throwIfAborted();
      return transcript;
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      if (/checksum|integrity|hash/i.test(message))
        throw new Error(
          "A speech model failed its integrity check. Click Set up transcription to download a verified copy.",
        );
      if (
        /urlopen error|HTTP Error|download|Temporary failure|CERTIFICATE_VERIFY_FAILED/i.test(
          message,
        )
      )
        throw new Error(
          "A required speech or word-alignment model could not download. Check your connection and try again. Completed downloads are kept.",
        );
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

export async function alignTranscripts(
  tracks: AudioTrack[],
  cacheDir: string,
  onProgress: Progress,
  signal: AbortSignal,
  selection?: CodexSelection,
): Promise<AlignmentResult> {
  return alignWithCodex(tracks, cacheDir, onProgress, signal, selection);
}
