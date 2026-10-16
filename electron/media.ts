import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  OperationProgress,
} from "../src/shared/types";

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

/** Small exact PCM windows keep auditioning sample-accurate without decoding entire recordings. */
export async function decodeAudioSlice(
  store: MediaStore,
  id: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const track = store.track(id);
  if (
    ![start, end].every(Number.isFinite) ||
    start < -1 / 48000 ||
    end <= start ||
    end > track.duration + 1 / 48000 ||
    end - start > 120 + 1 / 48000
  )
    throw new Error(
      "Preview intervals must be within the source and no longer than 120 seconds.",
    );
  const startSample = Math.max(0, Math.round(start * 48000));
  const endSample = Math.min(
    Math.round(track.duration * 48000),
    Math.round(end * 48000),
  );
  if (endSample <= startSample)
    throw new Error("A preview must contain at least one audio sample.");
  const ffmpeg = await findBinary("ffmpeg");
  const result = await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-ss",
      (startSample / 48000).toFixed(9),
      "-i",
      store.filename(id),
      "-t",
      ((endSample - startSample) / 48000).toFixed(9),
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-",
    ],
    {
      signal,
      maxBytes: (endSample - startSample) * 2 * 4 + 8192,
      timeoutMs: 60_000,
    },
  );
  return Uint8Array.from(result.stdout).buffer;
}

export async function renderMaster(
  store: MediaStore,
  clips: MasterClip[],
  destination: string,
  format: "wav" | "mp3",
  fadeMs: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
) {
  if (!clips.length)
    throw new Error("Choose at least one sentence before exporting.");
  if (clips.length > 5000)
    throw new Error("This mix has too many clips to export at once.");
  const ffmpeg = await findBinary("ffmpeg");
  const ids = [...new Set(clips.map((c) => c.trackId))];
  ids.forEach((id) => store.track(id));
  const filters: string[] = [];
  const labels = new Map<string, string[]>();
  for (const [index, id] of ids.entries()) {
    const names = clips
      .filter((c) => c.trackId === id)
      .map((_, n) => `s${index}_${n}`);
    labels.set(id, [...names]);
    filters.push(
      `[${index}:a]asplit=${names.length}${names.map((n) => `[${n}]`).join("")}`,
    );
  }
  for (const [index, clip] of clips.entries()) {
    const track = store.track(clip.trackId);
    if (
      ![clip.start, clip.end].every(Number.isFinite) ||
      clip.start < 0 ||
      clip.end <= clip.start ||
      clip.end > track.duration + 0.03
    )
      throw new Error("A selected clip has invalid audio boundaries.");
    const duration = clip.end - clip.start;
    const fade = Math.max(0, Math.min(20, fadeMs)) / 1000;
    const edge = Math.min(fade, duration / 2);
    filters.push(
      `[${labels.get(clip.trackId)!.shift()}]atrim=start=${clip.start.toFixed(6)}:end=${clip.end.toFixed(6)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${edge ? `,afade=t=in:st=0:d=${edge},afade=t=out:st=${Math.max(0, duration - edge)}:d=${edge}` : ""}[c${index}]`,
    );
  }
  filters.push(
    `${clips.map((_, i) => `[c${i}]`).join("")}concat=n=${clips.length}:v=0:a=1[out]`,
  );
  const filterFile = path.join(store.root, `export-${randomUUID()}.filter`);
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.${format}`,
  );
  const duration = clips.reduce(
    (total, clip) => total + clip.end - clip.start,
    0,
  );
  try {
    await writeFile(filterFile, filters.join(";\n"), { mode: 0o600 });
    const render = (filterOption: string) =>
      runProcess(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          ...ids.flatMap((id) => ["-i", store.filename(id)]),
          filterOption,
          filterFile,
          "-map",
          "[out]",
          ...(format === "mp3"
            ? ["-c:a", "libmp3lame", "-b:a", "320k"]
            : ["-c:a", "pcm_s24le", "-rf64", "auto"]),
          "-ar",
          "48000",
          "-progress",
          "pipe:1",
          temporary,
        ],
        {
          signal: options.signal,
          onStdout: (text) => {
            const m = /out_time_us=(\d+)/.exec(text);
            if (m)
              options.onProgress?.(Math.min(1, Number(m[1]) / 1e6 / duration));
          },
        },
      );
    try {
      await render("-/filter_complex");
    } catch (error) {
      // FFmpeg 9 removed the old spelling; older distributions need it.
      if (
        error instanceof Error &&
        error.message.includes("Unrecognized option '/filter_complex'")
      )
        await render("-filter_complex_script");
      else throw error;
    }
    await rename(temporary, destination);
  } finally {
    await Promise.all([
      rm(filterFile, { force: true }),
      rm(temporary, { force: true }),
    ]);
  }
}

export { createReadStream };
