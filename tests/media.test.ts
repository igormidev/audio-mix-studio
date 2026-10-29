import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MediaStore,
  byteRange,
  findBinary,
  renderMaster,
  runProcess,
  decodeAudioSlice,
} from "../electron/media";
import type { MasterClip } from "../src/shared/types";
import {
  appendTracks,
  applyAlignment,
  masterClips,
  masterDuration,
  newProject,
  setGroupSpeed,
  setJointDefaults,
  excludeMasterRange,
} from "../src/domain/project";

describe("bounded media byte ranges", () => {
  it("supports full, prefix, suffix and open-ended playback requests", () => {
    expect(byteRange(null, 100)).toEqual({ start: 0, end: 99, partial: false });
    expect(byteRange("bytes=0-9", 100)).toEqual({
      start: 0,
      end: 9,
      partial: true,
    });
    expect(byteRange("bytes=-20", 100)).toEqual({
      start: 80,
      end: 99,
      partial: true,
    });
    expect(byteRange("bytes=50-", 100)).toEqual({
      start: 50,
      end: 99,
      partial: true,
    });
    expect(byteRange("bytes=50-1000", 100)).toEqual({
      start: 50,
      end: 99,
      partial: true,
    });
  });
  it.each([
    "bytes=100-",
    "bytes=9-5",
    "bytes=-0",
    "bytes=1-2,5-6",
    "bytes=-",
    "nonsense",
    "bytes=9999999999999999999-",
  ])("rejects an invalid range: %s", (value) =>
    expect(byteRange(value, 100)).toBeNull(),
  );
});

describe("real FFmpeg media pipeline", () => {
  let directory: string;
  let ffmpeg: string;
  let ffprobe: string;
  let store: MediaStore;
  let source: string;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "mixstudio-media-test-"));
    [ffmpeg, ffprobe] = await Promise.all([
      findBinary("ffmpeg"),
      findBinary("ffprobe"),
    ]);
    source = path.join(directory, "two-tones.wav");
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=1",
      "-filter_complex",
      "[0:a][1:a]concat=n=2:v=0:a=1[out]",
      "-map",
      "[out]",
      source,
    ]);
    store = new MediaStore(path.join(directory, "cache"));
    await store.initialize();
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const packetCleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (packetCleanups.length) await packetCleanups.pop()!();
  });
  async function useWavPacketSize(size: number): Promise<void> {
    const binaries = await mkdtemp(path.join(directory, "wav-packets-"));
    // FFmpeg 6 defaults to small WAV packets; newer builds may choose larger
    // packets and hide atempo's sensitivity to seek-vs-atrim AVFrame boundaries.
    // Exercise both production paths under the older framing on every platform.
    await writeFile(
      path.join(binaries, "ffmpeg"),
      `#!/usr/bin/env node\nconst { spawnSync } = require('node:child_process');\nconst result = spawnSync(${JSON.stringify(ffmpeg)}, ['-max_size', ${JSON.stringify(String(size))}, ...process.argv.slice(2)], { stdio: 'inherit' });\nif (result.error) { console.error(result.error.message); process.exit(1); }\nprocess.exit(result.status ?? 1);\n`,
      { mode: 0o700 },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${binaries}${path.delimiter}${previousPath ?? ""}`;
    packetCleanups.push(async () => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(binaries, { recursive: true, force: true });
    });
  }
  it("copies immutable normalized audio, persists source IDs, and renders chosen segments in order", async () => {
    const original = await readFile(source);
    const track = await store.importAudio(source);
    expect(track.duration).toBeCloseTo(2, 2);
    expect(track.peaks.length).toBeGreaterThan(100);
    expect(track.peaks.length).toBeLessThanOrEqual(900);
    expect(Math.max(...track.peaks)).toBeGreaterThan(0.1);
    expect(track.mediaUrl).toBe(`mixmedia://audio/${track.id}`);
    expect(await readFile(source)).toEqual(original);
    const restored = new MediaStore(store.root);
    await restored.initialize();
    expect(restored.track(track.id).duration).toBe(track.duration);
    const clips: MasterClip[] = [
      {
        id: "second",
        groupId: "g1",
        trackId: track.id,
        start: 1,
        end: 1.5,
        text: "higher tone",
        enabled: true,
        offset: 0,
        duration: 0.5,
      },
      {
        id: "first",
        groupId: "g2",
        trackId: track.id,
        start: 0,
        end: 0.5,
        text: "lower tone",
        enabled: true,
        offset: 0.5,
        duration: 0.5,
      },
    ];
    const output = path.join(directory, "master.wav");
    await renderMaster(store, clips, output, "wav", 8);
    const result = await runProcess(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,sample_rate,channels,bits_per_raw_sample",
      "-of",
      "json",
      output,
    ]);
    const details = JSON.parse(result.stdout.toString());
    expect(Number(details.format.duration)).toBeCloseTo(1, 2);
    expect(details.streams[0]).toMatchObject({
      codec_name: "pcm_s24le",
      sample_rate: "48000",
      channels: 2,
      bits_per_raw_sample: "24",
    });
    const slice = await decodeAudioSlice(store, track.id, 0.5, 0.75);
    expect(slice.byteLength).toBe(12000 * 2 * 4);
    expect(
      new Float32Array(slice).some((sample) => Math.abs(sample) > 0.05),
    ).toBe(true);
    const singleFrame = await decodeAudioSlice(
      store,
      track.id,
      1000 / 48000,
      1001 / 48000,
    );
    expect(singleFrame.byteLength).toBe(8);
    await expect(decodeAudioSlice(store, track.id, -0.1, 0.75)).rejects.toThrow(
      "Preview intervals",
    );
    await expect(decodeAudioSlice(store, track.id, 0, 200)).rejects.toThrow(
      "Preview intervals",
    );
    // Decode each exported half and count zero crossings: this proves source ordering as well as duration.
    const decoded = await runProcess(ffmpeg, [
      "-v",
      "error",
      "-i",
      output,
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ]);
    const samples = new Float32Array(
      decoded.stdout.buffer,
      decoded.stdout.byteOffset,
      decoded.stdout.byteLength / 4,
    );
    const crossings = (from: number, to: number) => {
      let count = 0;
      for (let i = from + 1; i < to; i++)
        if (samples[i - 1] < 0 && samples[i] >= 0) count++;
      return count;
    };
    expect(crossings(1000, 23000)).toBeGreaterThan(
      crossings(25000, 47000) * 1.8,
    );
    const mp3 = path.join(directory, "master.mp3");
    await renderMaster(store, clips, mp3, "mp3", 8);
    expect((await readFile(mp3)).length).toBeGreaterThan(1000);
    const mp3Probe = await runProcess(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,bit_rate",
      "-of",
      "json",
      mp3,
    ]);
    expect(JSON.parse(mp3Probe.stdout.toString()).streams[0]).toMatchObject({
      codec_name: "mp3",
      bit_rate: "320000",
    });
  });
  it("does not let an opaque media ID become a filesystem path", () => {
    expect(() => store.filename("../../secret")).toThrow("Invalid media");
    expect(() => store.track("00000000-0000-0000-0000-000000000000")).toThrow(
      "missing",
    );
  });
  it("preserves every sample including leading, internal and trailing silence when choosing one complete take", async () => {
    const silentSource = path.join(directory, "natural-pauses.wav");
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=0.5",
      "-filter_complex",
      "[0:a]adelay=250,apad=whole_dur=1[a];[1:a]adelay=250,apad=whole_dur=1[b];[a][b]concat=n=2:v=0:a=1[out]",
      "-map",
      "[out]",
      silentSource,
    ]);
    const track = await store.importAudio(silentSource);
    const p = applyAlignment(appendTracks(newProject(), [track]), {
      groups: [
        {
          text: "First sentence",
          note: "",
          variations: [
            {
              trackId: track.id,
              start: 0.25,
              end: 0.75,
              text: "First sentence",
            },
          ],
        },
        {
          text: "Second sentence",
          note: "",
          variations: [
            {
              trackId: track.id,
              start: 1.25,
              end: 1.75,
              text: "Second sentence",
            },
          ],
        },
      ],
    });
    expect(masterClips(p).map((clip) => [clip.start, clip.end])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(masterDuration(p)).toBe(track.duration);
    const output = path.join(directory, "source-preserved.wav");
    await renderMaster(store, masterClips(p), output, "wav", 0);
    const raw = (filename: string) =>
      runProcess(ffmpeg, [
        "-v",
        "error",
        "-i",
        filename,
        "-c:a",
        "pcm_s24le",
        "-f",
        "s24le",
        "-",
      ]);
    const [before, after] = await Promise.all([
      raw(store.filename(track.id)),
      raw(output),
    ]);
    expect(after.stdout).toEqual(before.stdout);
    expect(after.stdout.byteLength).toBe(2 * 48000 * 2 * 3);
  });
  it("renders pitch-preserving sentence speed and exact joint pauses consistently with preview PCM", async () => {
    await useWavPacketSize(4096);
    const track = await store.importAudio(source);
    let p = applyAlignment(appendTracks(newProject(), [track]), {
      groups: [
        {
          text: "First tone",
          note: "",
          variations: [
            { trackId: track.id, start: 0, end: 1, text: "First tone" },
          ],
        },
        {
          text: "Second tone",
          note: "",
          variations: [
            { trackId: track.id, start: 1, end: 2, text: "Second tone" },
          ],
        },
      ],
    });
    p = setGroupSpeed(p, p.groups[0].id, 2.5);
    p = setGroupSpeed(p, p.groups[1].id, 0.5);
    p = setJointDefaults(p, { pauseMs: 250 });
    const clips = masterClips(p);
    const output = path.join(directory, "speed-pause.wav");
    await renderMaster(store, clips, output, "wav", 0);
    const decoded = await runProcess(ffmpeg, [
      "-v",
      "error",
      "-i",
      output,
      "-f",
      "f32le",
      "-",
    ]);
    const samples = new Float32Array(
      decoded.stdout.buffer,
      decoded.stdout.byteOffset,
      decoded.stdout.byteLength / 4,
    );
    expect(samples.length / 2).toBe(Math.round(masterDuration(p) * 48000));
    expect(masterDuration(p)).toBe(2.65);
    const [first, last] = await Promise.all([
      decodeAudioSlice(store, track.id, 0, 1, undefined, 2.5),
      decodeAudioSlice(store, track.id, 1, 2, undefined, 0.5),
    ]);
    const expected = new Float32Array(samples.length);
    expected.set(new Float32Array(first));
    expected.set(
      new Float32Array(last),
      Math.round(clips[1].offset * 48000) * 2,
    );
    let error = 0;
    for (let index = 0; index < samples.length; index++)
      error = Math.max(error, Math.abs(samples[index] - expected[index]));
    expect(error).toBeLessThan(0.000001);
    expect(
      samples.slice(19200 * 2, 31200 * 2).every((sample) => sample === 0),
    ).toBe(true);
    const frequency = (start: number, end: number) => {
      let crossings = 0;
      for (
        let frame = Math.round(start * 48000) + 1;
        frame < Math.round(end * 48000);
        frame++
      )
        if (samples[(frame - 1) * 2] < 0 && samples[frame * 2] >= 0)
          crossings++;
      return crossings / (end - start);
    };
    expect(frequency(0.05, 0.3)).toBeCloseTo(440, -1);
    expect(frequency(1, 1.5)).toBeCloseTo(880, -1);
    await expect(
      decodeAudioSlice(store, track.id, 0, 1, undefined, 2.6),
    ).rejects.toThrow(/speed/);
    await expect(
      decodeAudioSlice(store, track.id, 0, 1, undefined, 0.605),
    ).rejects.toThrow(/speed/);
    p = setJointDefaults(p, { fadeOutMs: 200, fadeInMs: 300 });
    const faded = path.join(directory, "speed-pause-fades.wav");
    await renderMaster(store, masterClips(p), faded, "wav", 0);
    const fadedProbe = await runProcess(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      faded,
    ]);
    expect(Number(fadedProbe.stdout.toString())).toBe(2.65);
  });
  it("removes a master range across sentence edges without inserting zeros or reordering retained samples", async () => {
    const track = await store.importAudio(source);
    let project = applyAlignment(appendTracks(newProject(), [track]), {
      groups: [
        {
          text: "Low tone",
          note: "",
          variations: [
            { trackId: track.id, start: 0, end: 1, text: "Low tone" },
          ],
        },
        {
          text: "High tone",
          note: "",
          variations: [
            { trackId: track.id, start: 1, end: 2, text: "High tone" },
          ],
        },
      ],
    });
    project = excludeMasterRange(project, 0.25, 1.25);
    const clips = masterClips(project);
    expect(clips.map((clip) => [clip.start, clip.end, clip.offset])).toEqual([
      [0, 0.25, 0],
      [1.25, 2, 0.25],
    ]);
    const output = path.join(directory, "master-cut-exact.wav");
    await renderMaster(store, clips, output, "wav", 0);
    const raw = (filename: string) =>
      runProcess(ffmpeg, [
        "-v",
        "error",
        "-i",
        filename,
        "-c:a",
        "pcm_s24le",
        "-f",
        "s24le",
        "-",
      ]);
    const [before, after] = await Promise.all([
      raw(store.filename(track.id)),
      raw(output),
    ]);
    const frameBytes = 2 * 3;
    const expected = Buffer.concat([
      before.stdout.subarray(0, 0.25 * 48000 * frameBytes),
      before.stdout.subarray(1.25 * 48000 * frameBytes),
    ]);
    expect(after.stdout).toEqual(expected);
    expect(after.stdout.byteLength).toBe(48000 * frameBytes);
  });
  it("agrees with preview ranges and time stretching after master cuts shorten two sentences", async () => {
    await useWavPacketSize(4096);
    const track = await store.importAudio(source);
    let project = applyAlignment(appendTracks(newProject(), [track]), {
      groups: [
        {
          text: "First tone",
          note: "",
          variations: [
            { trackId: track.id, start: 0, end: 1, text: "First tone" },
          ],
        },
        {
          text: "Second tone",
          note: "",
          variations: [
            { trackId: track.id, start: 1, end: 2, text: "Second tone" },
          ],
        },
      ],
    });
    project = excludeMasterRange(project, 0.25, 1.25);
    project = setGroupSpeed(project, project.groups[0].id, 1.25);
    project = setGroupSpeed(project, project.groups[1].id, 0.75);
    const clips = masterClips(project);
    expect(masterDuration(project)).toBe(1.2);
    const output = path.join(directory, "master-cut-speed.wav");
    await renderMaster(store, clips, output, "wav", 0);
    const exported = await runProcess(ffmpeg, [
      "-v",
      "error",
      "-i",
      output,
      "-f",
      "f32le",
      "-",
    ]);
    const samples = new Float32Array(
      exported.stdout.buffer,
      exported.stdout.byteOffset,
      exported.stdout.byteLength / 4,
    );
    const previewParts = await Promise.all(
      clips.map((clip) =>
        decodeAudioSlice(
          store,
          clip.trackId,
          clip.start,
          clip.end,
          undefined,
          clip.speed,
        ),
      ),
    );
    const expected = new Float32Array(samples.length);
    previewParts.forEach((part, index) =>
      expected.set(
        new Float32Array(part),
        Math.round(clips[index].offset * 48000) * 2,
      ),
    );
    expect(samples.length).toBe(1.2 * 48000 * 2);
    let maximumError = 0;
    for (let index = 0; index < samples.length; index++)
      maximumError = Math.max(
        maximumError,
        Math.abs(samples[index] - expected[index]),
      );
    expect(maximumError).toBeLessThan(0.000001);
  });
  it("rejects an invalid media import before touching a destination", async () => {
    const fake = path.join(directory, "not-audio.txt");
    await writeFile(fake, "hello");
    await expect(store.importAudio(fake)).rejects.toThrow("Unsupported");
  });
  it("cancels a running child process without leaving it active", async () => {
    const controller = new AbortController();
    const pending = runProcess(
      process.execPath,
      ["-e", "setInterval(() => {},1000)"],
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
});
