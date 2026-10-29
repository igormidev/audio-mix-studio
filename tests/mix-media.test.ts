import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MediaStore,
  decodeAudioSlice,
  decodeMixSlice,
  findBinary,
  renderMix,
  renderMaster,
  runProcess,
} from "../electron/media";
import { planPlayback } from "../src/ui/playback";
import {
  appendTracks,
  masterClips,
  newProject,
  setGroupSpeed,
} from "../src/domain/project";
import {
  addMixKeyframe,
  addMixPlacement,
  appendLibraryTracks,
  defaultMixSettings,
  mixDuration,
  soundMix,
  updateMixKeyframe,
  updateMixPlacement,
} from "../src/domain/soundMix";

function leftSamples(bytes: ArrayBuffer) {
  const stereo = new Float32Array(bytes);
  return Float32Array.from(
    { length: stereo.length / 2 },
    (_, index) => stereo[index * 2],
  );
}
function frequency(samples: Float32Array, from: number, until: number) {
  let crossings = 0;
  for (
    let frame = Math.round(from * 48000) + 1;
    frame < Math.round(until * 48000);
    frame++
  )
    if (samples[frame - 1] < 0 && samples[frame] >= 0) crossings++;
  return crossings / (until - from);
}

describe("real SoundTouch multitrack mix", () => {
  let directory: string, ffmpeg: string, store: MediaStore;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "mixstudio-soundtouch-"));
    ffmpeg = await findBinary("ffmpeg");
    store = new MediaStore(path.join(directory, "cache"));
    await store.initialize();
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  async function tone(hz: number) {
    const file = path.join(directory, `${hz}.wav`);
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${hz}:duration=4`,
      file,
    ]);
    return store.importAudio(file);
  }
  it("preserves pitch at one-percent speeds including both slider limits", async () => {
    const track = await tone(440);
    for (const speed of [0.5, 0.73, 1.37, 2]) {
      const samples = leftSamples(
        await decodeAudioSlice(store, track.id, 0, 4, undefined, speed),
      );
      expect(samples.length).toBe(Math.round((4 * 48000) / speed));
      expect(frequency(samples, 0.2, 1.7)).toBeCloseTo(440, -1);
    }
  });
  it("uses one complete tempo render across long preview chunks and late seeks", async () => {
    const file = path.join(directory, "long-tone.wav");
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=127",
      file,
    ]);
    const track = await store.importAudio(file);
    let p = appendTracks(newProject(), [track]);
    p = setGroupSpeed(p, p.groups[0].id, 1.37);
    const clips = masterClips(p),
      destination = path.join(directory, "long-export.wav");
    await renderMaster(store, clips, destination, "wav", 0);
    const decoded = await runProcess(
      ffmpeg,
      ["-v", "error", "-i", destination, "-f", "f32le", "-"],
      { maxBytes: 50 * 1024 * 1024 },
    );
    const exported = new Float32Array(
      decoded.stdout.buffer,
      decoded.stdout.byteOffset,
      decoded.stdout.byteLength / 4,
    );
    for (const from of [0, 63.123]) {
      const chunks = planPlayback(clips, from);
      for (const chunk of chunks) {
        const preview = new Float32Array(
          await decodeAudioSlice(
            store,
            track.id,
            chunk.start,
            chunk.end,
            undefined,
            chunk.speed,
            chunk.logicalSource,
          ),
        );
        const skip = Math.round(chunk.offset * 48000) * 2;
        let error = 0;
        for (let i = 0; i < preview.length; i++)
          error = Math.max(error, Math.abs(preview[i] - exported[skip + i]));
        expect(error).toBeLessThan(0.000001);
      }
    }
  });
  it("mixes simultaneous layers, piecewise speeds and custom fades identically when seeking or exporting", async () => {
    const [voice, music, effect] = await Promise.all([
      tone(220),
      tone(440),
      tone(880),
    ]);
    let project = appendTracks(newProject(), [voice]);
    project = appendLibraryTracks(project, [music], "music");
    project = appendLibraryTracks(project, [effect], "soundtrack");
    project = addMixPlacement(project, "music-1", music.id, 0.5);
    const placement = soundMix(project).placements[0];
    project = updateMixPlacement(project, placement.id, {
      settings: {
        ...defaultMixSettings(),
        speed: 1.37,
        volume: 0.3,
        fadeInMs: 700,
        fadeInStartMs: 100,
        fadeInCurve: "custom",
        fadeInPower: 3,
      },
    });
    project = addMixKeyframe(project, placement.id, 2);
    const keyframe = soundMix(project).placements[0].keyframes[0];
    project = updateMixKeyframe(project, placement.id, keyframe.id, {
      settings: {
        ...defaultMixSettings(),
        speed: 0.73,
        volume: 0.7,
        fadeOutMs: 800,
        fadeOutStartMs: 100,
        fadeOutCurve: "s-curve",
      },
    });
    project = addMixPlacement(project, "soundtrack-1", effect.id, 1.25);
    const effectPlacement = soundMix(project).placements[1];
    project = updateMixPlacement(project, effectPlacement.id, {
      end: 1,
      settings: {
        ...defaultMixSettings(),
        volume: 0.4,
        fadeInMs: 200,
        fadeInCurve: "ease-out",
      },
    });
    const destination = path.join(directory, "layered.wav");
    await renderMix(store, project, destination, "wav");
    const exported = await runProcess(
      ffmpeg,
      ["-v", "error", "-i", destination, "-f", "f32le", "-"],
      { maxBytes: 8 * 48000 * 10 },
    );
    expect(exported.stdout.byteLength).toBe(
      Math.round(mixDuration(project) * 48000) * 8,
    );
    for (const [start, end] of [
      [0, 1],
      [0.8, 2.7],
      [2.5, 4.1],
    ]) {
      const preview = new Float32Array(
        await decodeMixSlice(store, project, start, end),
      );
      const output = new Float32Array(
        exported.stdout.buffer,
        exported.stdout.byteOffset,
        exported.stdout.byteLength / 4,
      );
      const skip = Math.round(start * 48000) * 2;
      let maxError = 0;
      for (let i = 0; i < preview.length; i++)
        maxError = Math.max(maxError, Math.abs(preview[i] - output[skip + i]));
      expect(maxError).toBeLessThan(0.000001);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      decodeMixSlice(store, project, 0, 1, controller.signal),
    ).rejects.toThrow(/abort|cancel/i);
    await expect(decodeMixSlice(store, project, Number.NaN, 1)).rejects.toThrow(
      /interval/,
    );
  });
});
