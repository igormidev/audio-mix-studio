import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import type {
  AudioTrack,
  MasterClip,
  MixProject,
  MixRenderClip,
  FadeCurve,
  OperationProgress,
} from "../src/shared/types";
import { mixDuration, mixRenderClips } from "../src/domain/soundMix";

export const AUDIO_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "aiff",
  "aif",
  "flac",
  "ogg",
  "opus",
  "webm",
  "mp4",
];
const COLORS = [
  "#d38c47",
  "#66978a",
  "#8b86b7",
  "#c97883",
  "#6598b9",
  "#9c9c5d",
];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const isMediaId = (id: string) => UUID.test(id);
export const mediaUrl = (id: string) => `mixmedia://audio/${id}`;

export async function findBinary(name: string): Promise<string> {
  const directories = [
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  for (const directory of [...new Set(directories.filter(Boolean))]) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  throw new Error(
    `${name} is not installed. Install FFmpeg with Homebrew: brew install ffmpeg`,
  );
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}
export async function runProcess(
  binary: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    maxBytes?: number;
    timeoutMs?: number;
    onStdout?: (text: string) => void;
  } = {},
): Promise<RunResult> {
  if (options.signal?.aborted) throw new Error("Operation cancelled.");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let settled = false;
    let aborted = false;
    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    };
    const timer = setTimeout(abort, options.timeoutMs ?? 30 * 60_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ stdout: Buffer.concat(chunks), stderr });
    };
    child.stdout.on("data", (data: Buffer) => {
      options.onStdout?.(data.toString());
      size += data.length;
      if (size > (options.maxBytes ?? 16 * 1024 * 1024)) {
        child.kill("SIGKILL");
        finish(new Error("Audio command produced too much output."));
        return;
      }
      chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-10_000);
    });
    child.on("error", (error) =>
      finish(
        new Error(`Could not run ${path.basename(binary)}: ${error.message}`),
      ),
    );
    child.on("close", (code) =>
      finish(
        aborted
          ? new Error("Operation cancelled or timed out.")
          : code === 0
            ? undefined
            : new Error(
                `${path.basename(binary)} failed: ${stderr.slice(-2000) || `exit ${code}`}`,
              ),
      ),
    );
  });
}

export async function atomicJSON(filename: string, value: unknown) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class MediaStore {
  readonly mediaDirectory: string;
  private tracks = new Map<string, AudioTrack>();
  constructor(readonly root: string) {
    this.mediaDirectory = path.join(root, "media");
  }
  async initialize() {
    await mkdir(this.mediaDirectory, { recursive: true });
    try {
      const entries: unknown = JSON.parse(
        await readFile(path.join(this.mediaDirectory, "manifest.json"), "utf8"),
      );
      if (Array.isArray(entries))
        for (const entry of entries) {
          if (
            entry &&
            typeof entry.id === "string" &&
            isMediaId(entry.id) &&
            typeof entry.name === "string" &&
            Number.isFinite(entry.duration) &&
            Array.isArray(entry.peaks)
          ) {
            const file = await stat(this.filename(entry.id)).catch(() => null);
            if (file?.isFile())
              this.tracks.set(entry.id, {
                ...entry,
                mediaUrl: mediaUrl(entry.id),
              });
          }
        }
    } catch {
      /* first launch or stale cache */
    }
  }
  filename(id: string) {
    if (!isMediaId(id)) throw new Error("Invalid media identifier.");
    return path.join(this.mediaDirectory, `${id}.wav`);
  }
  has(id: string) {
    return this.tracks.has(id);
  }
  track(id: string) {
    const track = this.tracks.get(id);
    if (!track)
      throw new Error(
        "An audio file is missing. Reimport it or open the portable project again.",
      );
    return { ...track, peaks: [...track.peaks] };
  }
  private async persist() {
    await atomicJSON(path.join(this.mediaDirectory, "manifest.json"), [
      ...this.tracks.values(),
    ]);
  }
  async importAudio(
    source: string,
    options: {
      signal?: AbortSignal;
      colorIndex?: number;
      onProgress?: (p: OperationProgress) => void;
      name?: string;
    } = {},
  ): Promise<AudioTrack> {
    if (
      typeof source !== "string" ||
      !path.isAbsolute(source) ||
      source.includes("\0")
    )
      throw new Error("Choose a valid audio file.");
    const extension = path.extname(source).slice(1).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(extension))
      throw new Error(`Unsupported audio format: ${extension || "unknown"}.`);
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size > 16 * 1024 ** 3)
      throw new Error("Choose a regular audio file smaller than 16 GiB.");
    const [ffmpeg, ffprobe] = await Promise.all([
      findBinary("ffmpeg"),
      findBinary("ffprobe"),
    ]);
    const probe = await runProcess(
      ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        source,
      ],
      { signal: options.signal, timeoutMs: 30_000 },
    );
    const details = JSON.parse(probe.stdout.toString());
    let duration = Number(details.format?.duration);
    if (
      !details.streams?.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 12 * 3600
    )
      throw new Error(
        "The file must contain audio between 0 and 12 hours long.",
      );
    const id = randomUUID();
    const target = this.filename(id);
    const temporary = `${target}.tmp.wav`;
    options.onProgress?.({
      phase: "importing",
      message: `Preparing ${path.basename(source)}…`,
    });
    try {
      await runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          source,
          "-vn",
          "-map",
          "0:a:0",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-c:a",
          "pcm_s24le",
          "-rf64",
          "auto",
          temporary,
        ],
        { signal: options.signal },
      );
      await rename(temporary, target);
      const normalizedProbe = await runProcess(
        ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=nw=1:nk=1",
          target,
        ],
        { signal: options.signal, timeoutMs: 30_000 },
      );
      duration = Number(normalizedProbe.stdout.toString().trim());
      if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 3600)
        throw new Error("The decoded audio has an invalid duration.");
      // Measure peaks before downsampling; resampling raw speech to a low rate would erase its energy.
      const chunkSize = Math.max(64, Math.ceil((duration * 48000) / 900));
      const envelope = await runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-i",
          target,
          "-af",
          `aformat=channel_layouts=mono,asetnsamples=n=${chunkSize}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-`,
          "-f",
          "null",
          "-",
        ],
        { signal: options.signal, maxBytes: 2 * 1024 * 1024 },
      );
      const measured = [
        ...envelope.stdout
          .toString()
          .matchAll(/lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+|-[Ii]nf)/g),
      ].map((match) => {
        const decibels = Number(match[1]);
        return Math.max(
          0.018,
          Math.min(
            1,
            Number.isFinite(decibels) ? 10 ** (decibels / 20) * 2.5 : 0,
          ),
        );
      });
      const peaks = measured.length ? measured.slice(0, 900) : [0.018];
      const track: AudioTrack = {
        id,
        name: options.name || path.basename(source),
        duration,
        color: COLORS[(options.colorIndex ?? this.tracks.size) % COLORS.length],
        peaks,
        mediaUrl: mediaUrl(id),
      };
      this.tracks.set(id, track);
      await this.persist();
      return this.track(id);
    } catch (error) {
      this.tracks.delete(id);
      await rm(target, { force: true });
      throw error;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  async copyAsset(id: string, destination: string) {
    this.track(id);
    await copyFile(this.filename(id), destination);
  }
}

export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number; partial: boolean } | null {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  end = Math.min(end, size - 1);
  return { start, end, partial: true };
}

interface TempoAsset {
  filename: string;
  startFrame: number;
  frames: number;
}
const tempoTasks = new Map<
  string,
  { task: Promise<TempoAsset>; owner?: AbortSignal }
>();

async function tempoAsset(
  store: MediaStore,
  clip: Pick<MasterClip, "trackId" | "start" | "end" | "speed">,
  signal?: AbortSignal,
): Promise<TempoAsset> {
  signal?.throwIfAborted();
  if ((clip.speed ?? 1) === 1) return createTempoAsset(store, clip, signal);
  const key = JSON.stringify([
    store.root,
    clip.trackId,
    Math.round(clip.start * 48000),
    Math.round(clip.end * 48000),
    clip.speed,
  ]);
  const existing = tempoTasks.get(key);
  if (existing) {
    let abort: (() => void) | undefined;
    try {
      return await (signal
        ? Promise.race([
            existing.task,
            new Promise<never>((_, reject) => {
              abort = () => reject(new Error("Playback cancelled."));
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            }),
          ])
        : existing.task);
    } catch (error) {
      signal?.throwIfAborted();
      if (existing.owner?.aborted) return tempoAsset(store, clip, signal);
      throw error;
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  const task = createTempoAsset(store, clip, signal).finally(() =>
    tempoTasks.delete(key),
  );
  tempoTasks.set(key, { task, owner: signal });
  return task;
}

/** SoundTouch tempo-only processing, the default Change Tempo engine in Audacity.
 * Cached source intervals are shared by preview and export; pitch/rate are never changed.
 */
async function createTempoAsset(
  store: MediaStore,
  clip: Pick<MasterClip, "trackId" | "start" | "end" | "speed">,
  signal?: AbortSignal,
): Promise<{ filename: string; startFrame: number; frames: number }> {
  const track = store.track(clip.trackId);
  const speed = clip.speed ?? 1;
  validatePlaybackSpeed(speed);
  if (
    ![clip.start, clip.end].every(Number.isFinite) ||
    clip.start < 0 ||
    clip.end <= clip.start ||
    clip.end > track.duration + 1 / 48000
  )
    throw new Error("A selected clip has invalid audio boundaries.");
  const start = Math.max(0, Math.round(clip.start * 48000));
  const end = Math.min(
    Math.round(track.duration * 48000),
    Math.round(clip.end * 48000),
  );
  const frames = Math.round((end - start) / speed);
  if (frames < 1) throw new Error("A selected clip has no audible samples.");
  if (speed === 1)
    return {
      filename: store.filename(clip.trackId),
      startFrame: start,
      frames,
    };
  let soundstretch: string;
  try {
    soundstretch = await findBinary("soundstretch");
  } catch {
    throw new Error(
      "SoundTouch is required for pitch-preserving speed. Install it with “brew install sound-touch”, then recheck Studio settings.",
    );
  }
  const engine = await stat(soundstretch);
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        "soundtouch-2-v1",
        engine.size,
        engine.mtimeMs,
        clip.trackId,
        start,
        end,
        speed,
      ]),
    )
    .digest("hex");
  const directory = path.join(store.root, "tempo-cache");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${key}.wav`);
  if (
    await stat(filename)
      .then((file) => file.isFile() && file.size >= frames * 8)
      .catch(() => false)
  )
    return { filename, startFrame: 0, frames };
  const scratch = path.join(directory, randomUUID());
  const input = `${scratch}.input.wav`,
    stretched = `${scratch}.stretch.wav`,
    output = `${scratch}.out.wav`;
  const ffmpeg = await findBinary("ffmpeg");
  try {
    await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        (start / 48000).toFixed(9),
        "-i",
        store.filename(clip.trackId),
        "-af",
        `atrim=end_sample=${end - start},asetpts=PTS-STARTPTS`,
        "-c:a",
        "pcm_f32le",
        input,
      ],
      { signal },
    );
    await runProcess(
      soundstretch,
      [input, stretched, `-tempo=${((speed - 1) * 100).toFixed(8)}`],
      { signal },
    );
    await runProcess(
      ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        stretched,
        "-af",
        `apad=whole_len=${frames},atrim=end_sample=${frames}`,
        "-c:a",
        "pcm_f32le",
        output,
      ],
      { signal },
    );
    signal?.throwIfAborted();
    await rename(output, filename);
    return { filename, startFrame: 0, frames };
  } finally {
    await Promise.all(
      [input, stretched, output].map((file) => rm(file, { force: true })),
    );
  }
}

export function validatePlaybackSpeed(speed: number): void {
  if (
    !Number.isFinite(speed) ||
    speed < 0.5 ||
    speed > 2.5 ||
    Math.abs(speed * 100 - Math.round(speed * 100)) > 0.000001
  )
    throw new Error("Audio speed must be 0.5×–2.5× in one-percent steps.");
}

/** Small exact PCM windows keep auditioning sample-accurate. */
export async function decodeAudioSlice(
  store: MediaStore,
  id: string,
  start: number,
  end: number,
  signal?: AbortSignal,
  speed = 1,
  logicalSource?: { start: number; end: number },
): Promise<ArrayBuffer> {
  const track = store.track(id);
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > track.duration + 1 / 48000 ||
    end - start > 120 + 1 / 48000
  )
    throw new Error(
      "Preview intervals must be within the source and no longer than 120 seconds.",
    );
  if (
    logicalSource &&
    (!Number.isFinite(logicalSource.start) ||
      !Number.isFinite(logicalSource.end) ||
      logicalSource.start < 0 ||
      logicalSource.end > track.duration + 1 / 48000 ||
      logicalSource.start > start ||
      logicalSource.end < end)
  )
    throw new Error("Invalid logical preview source.");
  const asset = await tempoAsset(
    store,
    {
      trackId: id,
      start: logicalSource?.start ?? start,
      end: logicalSource?.end ?? end,
      speed,
    },
    signal,
  );
  const outputSkip = logicalSource
    ? Math.round(
        (Math.round(start * 48000) - Math.round(logicalSource.start * 48000)) /
          speed,
      )
    : 0;
  const outputFrames = Math.round(
    (Math.round(end * 48000) - Math.round(start * 48000)) / speed,
  );
  const ffmpeg = await findBinary("ffmpeg");
  const result = await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-nostdin",
      "-ss",
      ((asset.startFrame + outputSkip) / 48000).toFixed(9),
      "-i",
      asset.filename,
      "-af",
      `atrim=end_sample=${outputFrames},asetpts=PTS-STARTPTS`,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-",
    ],
    { signal, maxBytes: outputFrames * 8 + 8192, timeoutMs: 60_000 },
  );
  return Uint8Array.from(result.stdout).buffer;
}

function curveExpression(
  value: string,
  curve: FadeCurve | undefined,
  power: number,
): string {
  if (curve === "ease-in") return `pow(${value},2)`;
  if (curve === "ease-out") return `(1-pow(1-${value},2))`;
  if (curve === "s-curve") return `(${value}*${value}*(3-2*${value}))`;
  if (curve === "custom") return `pow(${value},${power})`;
  return value;
}

function gainExpression(
  clip: MixRenderClip,
  duration: number,
  fadeMs: number,
): string {
  const volume = clip.volume ?? 1;
  const inStart = (clip.fadeInStartMs ?? 0) / 1000;
  const outStart = (clip.fadeOutStartMs ?? 0) / 1000;
  let fadeIn = (clip.fadeInMs ?? fadeMs) / 1000;
  let fadeOut = (clip.fadeOutMs ?? fadeMs) / 1000;
  const inPower = clip.fadeInPower ?? 1,
    outPower = clip.fadeOutPower ?? 1;
  if (
    ![volume, inStart, outStart, fadeIn, fadeOut, inPower, outPower].every(
      Number.isFinite,
    ) ||
    volume < 0 ||
    volume > 2 ||
    Math.min(inStart, outStart, fadeIn, fadeOut) < 0 ||
    inPower < 0.1 ||
    inPower > 10 ||
    outPower < 0.1 ||
    outPower > 10
  )
    throw new Error("Invalid clip volume or fade settings.");
  // Preserve narration's independent edge-fade contract, including short clips.
  if (
    !clip.fadeInStartMs &&
    !clip.fadeOutStartMs &&
    fadeIn + fadeOut > duration
  ) {
    const factor = duration / (fadeIn + fadeOut);
    fadeIn *= factor;
    fadeOut *= factor;
  }
  const a = fadeIn
    ? curveExpression(
        `clip((t-${inStart})/${fadeIn},0,1)`,
        clip.fadeInCurve,
        inPower,
      )
    : "1";
  const b = fadeOut
    ? `(1-${curveExpression(
        `(1-clip((${duration - outStart}-t)/${fadeOut},0,1))`,
        clip.fadeOutCurve,
        outPower,
      )})`
    : "1";
  return `${volume}*min(${a},${b})`;
}

async function timelineGraph(
  store: MediaStore,
  clips: MixRenderClip[],
  duration: number,
  from: number,
  until: number,
  fadeMs: number,
  signal?: AbortSignal,
) {
  if (
    !clips.length ||
    clips.length > 5000 ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new Error(
      "Choose audio before exporting; a mix supports up to 5000 clips.",
    );
  const first = Math.round(from * 48000),
    last = Math.round(until * 48000);
  const selected = clips.filter((clip) => {
    if (!Number.isFinite(clip.offset) || clip.offset < 0)
      throw new Error("Invalid clip placement.");
    return (
      Math.round((clip.offset + clip.duration) * 48000) > first &&
      Math.round(clip.offset * 48000) < last
    );
  });
  const filenames: string[] = [],
    inputStarts: number[] = [],
    filters: string[] = [];
  const prepared: {
    clip: MixRenderClip;
    asset: Awaited<ReturnType<typeof tempoAsset>>;
    input: number;
    localStart: number;
    localEnd: number;
    delay: number;
  }[] = [];
  for (const clip of selected) {
    signal?.throwIfAborted();
    const asset = await tempoAsset(store, clip, signal);
    const offset = Math.round(clip.offset * 48000);
    const localStart = Math.max(0, first - offset),
      localEnd = Math.min(asset.frames, last - offset);
    let input = filenames.indexOf(asset.filename);
    if (input < 0) {
      input = filenames.length;
      filenames.push(asset.filename);
      inputStarts.push(asset.startFrame + localStart);
    } else
      inputStarts[input] = Math.min(
        inputStarts[input],
        asset.startFrame + localStart,
      );
    prepared.push({
      clip,
      asset,
      input,
      localStart,
      localEnd,
      delay: Math.max(0, offset - first),
    });
  }
  filenames.forEach((_, input) => {
    const outputs = prepared.flatMap((item, index) =>
      item.input === input ? [`[s${index}]`] : [],
    );
    filters.push(`[${input}:a]asplit=${outputs.length}${outputs.join("")}`);
  });
  prepared.forEach(
    ({ clip, asset, input, localStart, localEnd, delay }, index) => {
      const gain = gainExpression(
        clip,
        asset.frames / 48000,
        Math.max(0, Math.min(20, fadeMs)),
      ).replace(/\bt\b/g, `(t+${localStart / 48000})`);
      const trimStart = asset.startFrame + localStart - inputStarts[input],
        trimEnd = asset.startFrame + localEnd - inputStarts[input];
      filters.push(
        `[s${index}]atrim=start_sample=${trimStart}:end_sample=${trimEnd},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aeval=exprs='val(0)*(${gain})|val(1)*(${gain})',adelay=${delay}S:all=1[c${index}]`,
      );
    },
  );
  const frames = last - first;
  if (!selected.length)
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=end_sample=${frames}[out]`);
  else
    filters.push(
      `${selected.map((_, i) => `[c${i}]`).join("")}amix=inputs=${selected.length}:normalize=0:duration=longest:dropout_transition=0,apad=whole_len=${frames},atrim=end_sample=${frames}[out]`,
    );
  return { filenames, inputStarts, filters, frames };
}

async function runTimeline(
  store: MediaStore,
  clips: MixRenderClip[],
  duration: number,
  from: number,
  until: number,
  fadeMs: number,
  output: string[],
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    maxBytes?: number;
  } = {},
) {
  const graph = await timelineGraph(
    store,
    clips,
    duration,
    from,
    until,
    fadeMs,
    options.signal,
  );
  const filterFile = path.join(store.root, `mix-${randomUUID()}.filter`);
  const ffmpeg = await findBinary("ffmpeg");
  try {
    await writeFile(filterFile, graph.filters.join(";\n"), { mode: 0o600 });
    const render = (filterOption: string) =>
      runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          ...graph.filenames.flatMap((file, index) => [
            "-ss",
            (graph.inputStarts[index] / 48000).toFixed(9),
            "-i",
            file,
          ]),
          filterOption,
          filterFile,
          "-map",
          "[out]",
          "-ar",
          "48000",
          "-ac",
          "2",
          ...output,
        ],
        {
          signal: options.signal,
          maxBytes: options.maxBytes,
          onStdout: options.onProgress
            ? (text) => {
                const m = /out_time_us=(\d+)/.exec(text);
                if (m)
                  options.onProgress?.(
                    Math.min(1, Number(m[1]) / 1e6 / (until - from)),
                  );
              }
            : undefined,
        },
      );
    try {
      return await render("-/filter_complex");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Unrecognized option '/filter_complex'")
      )
        return await render("-filter_complex_script");
      throw error;
    }
  } finally {
    await rm(filterFile, { force: true });
  }
}

export async function decodeMixSlice(
  store: MediaStore,
  project: MixProject,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const duration = mixDuration(project);
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > duration + 1 / 48000 ||
    end - start > 60
  )
    throw new Error("Invalid mixed preview interval.");
  const result = await runTimeline(
    store,
    mixRenderClips(project),
    duration,
    start,
    end,
    project.joinFadeMs,
    ["-f", "f32le", "-"],
    { signal, maxBytes: Math.round((end - start) * 48000) * 8 + 8192 },
  );
  return Uint8Array.from(result.stdout).buffer;
}

export async function renderMix(
  store: MediaStore,
  project: MixProject,
  destination: string,
  format: "wav" | "mp3",
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
) {
  return renderTimeline(
    store,
    mixRenderClips(project),
    destination,
    format,
    project.joinFadeMs,
    options,
  );
}

async function renderTimeline(
  store: MediaStore,
  clips: MixRenderClip[],
  destination: string,
  format: "wav" | "mp3",
  fadeMs: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
) {
  const duration = Math.max(
    0,
    ...clips.map((clip) => clip.offset + clip.duration),
  );
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.${format}`,
  );
  try {
    await runTimeline(
      store,
      clips,
      duration,
      0,
      duration,
      fadeMs,
      [
        ...(format === "mp3"
          ? ["-c:a", "libmp3lame", "-b:a", "320k"]
          : ["-c:a", "pcm_s24le", "-rf64", "auto"]),
        "-progress",
        "pipe:1",
        temporary,
      ],
      options,
    );
    options.signal?.throwIfAborted();
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Narration-only API retained for exact source and joint regression coverage. */
export async function renderMaster(
  store: MediaStore,
  clips: MasterClip[],
  destination: string,
  format: "wav" | "mp3",
  fadeMs: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
) {
  let offset = 0;
  const ordered = clips.map((clip) => {
    offset += Math.round((clip.pauseBeforeMs ?? 0) * 48) / 48000;
    const duration =
      Math.round(
        (Math.round(clip.end * 48000) - Math.round(clip.start * 48000)) /
          (clip.speed ?? 1),
      ) / 48000;
    const result = { ...clip, offset, duration };
    offset += duration;
    return result;
  });
  return renderTimeline(store, ordered, destination, format, fadeMs, options);
}

export { createReadStream };
