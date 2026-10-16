import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
