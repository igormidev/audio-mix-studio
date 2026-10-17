import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendTracks,
  masterClips,
  newProject,
  splitSegment,
  trimSegment,
  setGroupSpeed,
  setJointDefaults,
} from "../src/domain/project";
import type { MixProject } from "../src/shared/types";
import {
  deinterleavePCM,
  edgeFadeSeconds,
  chunkGainEnvelope,
  PCM_SAMPLE_RATE,
  planPlayback,
} from "../src/ui/playback";

// Deterministic hook/media scheduling checks without Electron or a real speaker.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanup: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useCallback: <T>(fn: T) => fn,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect: (effect: () => (() => void) | undefined) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      const cleanup = effect();
      if (cleanup) hooks.cleanup.push(cleanup);
    }
  },
}));
import { usePlayer } from "../src/ui/usePlayer";

class TestBuffer {
  readonly duration: number;
  copyToChannel = vi.fn();
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
  }
}
class TestGain {
  gain = { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}
class TestSource {
  buffer: TestBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  finish() {
    this.onended?.();
  }
}
class TestContext {
  static instances: TestContext[] = [];
  currentTime = 0;
  destination = {};
  sources: TestSource[] = [];
  gains: TestGain[] = [];
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  constructor() {
    TestContext.instances.push(this);
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new TestBuffer(channels, length, rate);
  }
  createBufferSource() {
    const source = new TestSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = new TestGain();
    this.gains.push(gain);
    return gain;
  }
}
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const audioSlice =
  vi.fn<
    (
      trackId: string,
      start: number,
      end: number,
      speed?: number,
    ) => Promise<ArrayBuffer>
  >();
function pcm(seconds: number): ArrayBuffer {
  return new ArrayBuffer(Math.round(seconds * PCM_SAMPLE_RATE) * 8);
}
function tick(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}
async function settle(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function deferred() {
  let resolve!: (bytes: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ArrayBuffer>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source(): MixProject {
  return appendTracks(newProject(), [
    {
      id: "a",
      name: "Take A",
      duration: 12,
      color: "#558899",
      mediaUrl: "mixmedia://audio/a",
      peaks: [],
    },
  ]);
}
function runner(project: MixProject) {
  const errors = vi.fn();
  return {
    errors,
    render() {
      hooks.cursor = 0;
      return usePlayer(project, masterClips(project), errors);
    },
  };
}
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.cleanup = [];
  TestContext.instances = [];
  frames.clear();
  frameId = 0;
  audioSlice.mockReset();
  audioSlice.mockImplementation((_track, start, end, speed = 1) =>
    Promise.resolve(pcm((end - start) / speed)),
  );
  vi.stubGlobal("AudioContext", TestContext);
  vi.stubGlobal("window", { studio: { audioSlice } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  hooks.cleanup.forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("precise playback planning", () => {
  it("keeps output-frame totals exact for every supported speed across long chunks", () => {
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5]) {
      const chunks = planPlayback([
        {
          id: "long",
          trackId: "a",
          start: 1,
          end: 134.000125,
          offset: 0,
          speed,
        },
      ]);
      const frames = chunks.reduce(
        (total, chunk) => total + Math.round(chunk.duration * PCM_SAMPLE_RATE),
        0,
      );
      expect(frames).toBe(
        Math.round(Math.round(133.000125 * PCM_SAMPLE_RATE) / speed),
      );
      expect(
        chunks.every(
          (chunk) => chunk.end - chunk.start <= 60 + 1 / PCM_SAMPLE_RATE,
        ),
      ).toBe(true);
      expect(
        chunks.every((chunk) => chunk.duration <= 60 + 1 / PCM_SAMPLE_RATE),
      ).toBe(true);
    }
  });
  it("represents real joint pauses and seeks inside them without requesting fake source audio", () => {
    const chunks = planPlayback(
      [
        { id: "first", trackId: "a", start: 0, end: 2, offset: 0, speed: 2 },
        { id: "next", trackId: "b", start: 4, end: 6, offset: 1.5, speed: 0.5 },
      ],
      1.25,
    );
    expect(
      chunks.map((chunk) => [
        Boolean(chunk.silent),
        chunk.offset,
        chunk.duration,
      ]),
    ).toEqual([
      [true, 1.25, 0.25],
      [false, 1.5, 4],
    ]);
  });
  it("continues a long fade across a decoder chunk boundary without restarting gain", () => {
    const chunks = planPlayback([
      {
        id: "fade",
        trackId: "a",
        start: 0,
        end: 62,
        offset: 0,
        fadeOutMs: 5000,
      },
    ]);
    const preceding = chunkGainEnvelope(chunks[0]);
    const last = chunkGainEnvelope(chunks[1]);
    expect(preceding[preceding.length - 1].value).toBeCloseTo(0.4);
    expect(last[0].value).toBeCloseTo(0.4);
    expect(last[last.length - 1]).toEqual({ time: 2, value: 0 });
  });
  it("chunks long sources at exact samples and fades only the logical clip edges", () => {
    const chunks = planPlayback([
      { id: "clip", trackId: "a", start: 1, end: 134, offset: 0 },
    ]);
    expect(chunks.map((chunk) => chunk.duration)).toEqual([60, 60, 13]);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 60, 120]);
    expect(chunks.map((chunk) => [chunk.start, chunk.end])).toEqual([
      [1, 61],
      [61, 121],
      [121, 134],
    ]);
    expect(chunks.map((chunk) => edgeFadeSeconds(chunk, 8))).toEqual([
      { fadeIn: 0.008, fadeOut: 0 },
      { fadeIn: 0, fadeOut: 0 },
      { fadeIn: 0, fadeOut: 0.008 },
    ]);
  });
  it("maps seeking through trimmed source gaps without reintroducing discarded audio", () => {
    const chunks = planPlayback(
      [
        { id: "one", trackId: "a", start: 1, end: 3, offset: 0 },
        { id: "two", trackId: "a", start: 7, end: 10, offset: 2 },
      ],
      2.5,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      start: 7.5,
      end: 10,
      offset: 2.5,
      duration: 2.5,
    });
    expect(
      planPlayback(
        [{ id: "one", trackId: "a", start: 1, end: 3, offset: 0 }],
        2,
      ),
    ).toEqual([]);
    expect(() => planPlayback([], Number.NaN)).toThrow(/Invalid/);
  });
  it("deinterleaves little-endian stereo and rejects malformed or nonfinite PCM", () => {
    const bytes = new ArrayBuffer(16);
    const view = new DataView(bytes);
    [0.25, -0.5, 0.75, -1].forEach((value, index) =>
      view.setFloat32(index * 4, value, true),
    );
    const [left, right] = deinterleavePCM(bytes);
    expect([...left]).toEqual([0.25, 0.75]);
    expect([...right]).toEqual([-0.5, -1]);
    expect(() => deinterleavePCM(new ArrayBuffer(7))).toThrow(/invalid PCM/);
    view.setFloat32(0, Number.NaN, true);
    expect(() => deinterleavePCM(bytes)).toThrow(/invalid samples/);
  });
});

describe("Web Audio playback scheduling", () => {
  it("uses pitch-preserving sentence speed and schedules the joint pause exactly once", async () => {
    const original = source();
    let p = splitSegment(original, original.segments[0].id, 6);
    // Give the second half its own sentence so the joint has independent settings.
    const tail = p.segments[1];
    p = {
      ...p,
      groups: [
        { ...p.groups[0], segmentIds: [p.segments[0].id] },
        {
          id: "second",
          text: "Second",
          note: "",
          segmentIds: [tail.id],
          speed: 1,
        },
      ],
      segments: p.segments.map((segment) =>
        segment.id === tail.id ? { ...segment, groupId: "second" } : segment,
      ),
    };
    p = setGroupSpeed(p, p.groups[0].id, 2);
    p = setGroupSpeed(p, "second", 0.5);
    p = setJointDefaults(p, { pauseMs: 500, fadeOutMs: 200, fadeInMs: 300 });
    const test = runner(p);
    test.render().playMaster();
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice).toHaveBeenCalledWith("a", 0, 6, 2);
    expect(audioSlice).toHaveBeenCalledWith("a", 6, 12, 0.5);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 3);
    expect(context.sources[1].start).toHaveBeenCalledWith(3.035, 0, 0.5);
    context.currentTime = 3.035;
    context.sources[0].finish();
    await settle();
    expect(context.sources[2].start).toHaveBeenCalledWith(3.535, 0, 12);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      3.035,
    );
    expect(context.gains[2].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      3.835,
    );
  });
  it("applies sentence speed to sentence previews while full-source previews remain 1×", async () => {
    let p = source();
    p = setGroupSpeed(p, p.groups[0].id, 2.5);
    const test = runner(p);
    test.render().preview(p.segments[0]);
    await settle();
    expect(audioSlice).toHaveBeenLastCalledWith("a", 0, 12, 2.5);
    test.render().stop();
    test
      .render()
      .preview({ ...p.segments[0], id: "source-preview", groupId: "" });
    await settle();
    expect(audioSlice).toHaveBeenLastCalledWith("a", 0, 12, 1);
  });
  it("previews exact trimmed source ranges and leaves the master cursor alone", async () => {
    const original = source();
    const p = trimSegment(original, original.segments[0].id, 2, 4);
    const test = runner(p);
    test.render().seek(0.7);
    test.render().preview(p.segments[0]);
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice).toHaveBeenCalledWith("a", 2, 4, 1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 2);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      2.035,
    );
    expect(test.render().position).toBe(0.7);
    context.sources[0].finish();
    expect(test.render().playing).toBe(false);
    expect(test.render().position).toBe(0.7);
    expect(test.errors).not.toHaveBeenCalled();
  });
  it("schedules separate retained pieces contiguously even while visual frames do not run", async () => {
    const original = source();
    let p = splitSegment(original, original.segments[0].id, 5);
    p = trimSegment(p, p.segments[0].id, 1, 3);
    p = trimSegment(p, p.segments[1].id, 7, 10);
    const test = runner(p);
    test.render().previewMany(p.segments);
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice.mock.calls).toEqual([
      ["a", 1, 3, 1],
      ["a", 7, 10, 1],
    ]);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 2);
    expect(context.sources[1].start).toHaveBeenCalledWith(2.035, 0, 3);
    context.currentTime = 20;
    expect(context.sources).toHaveLength(2); // Audio source scheduling is independent of RAF.
  });
  it("starts the first decoded section while a slower second section prepares", async () => {
    const original = source();
    const p = splitSegment(original, original.segments[0].id, 5);
    const second = deferred();
    audioSlice.mockImplementation((_id, start, end) =>
      start === 5 ? second.promise : Promise.resolve(pcm(end - start)),
    );
    const test = runner(p);
    test.render().previewMany(p.segments);
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice).toHaveBeenCalledWith("a", 5, 12, 1);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 5);
    expect(test.render().preparing).toBe(false);
    expect(frames.size).toBe(0); // Previews need no master-cursor animation.

    context.currentTime = 0.5;
    second.resolve(pcm(7));
    await settle();
    expect(context.sources[1].start).toHaveBeenCalledWith(5.035, 0, 7);
    expect(test.errors).not.toHaveBeenCalled();
  });
  it("keeps source order when the second section decodes before the first", async () => {
    const original = source();
    const p = splitSegment(original, original.segments[0].id, 5);
    const first = deferred();
    audioSlice.mockImplementation((_id, start, end) =>
      start === 0 ? first.promise : Promise.resolve(pcm(end - start)),
    );
    const test = runner(p);
    test.render().previewMany(p.segments);
    await settle();
    const context = TestContext.instances[0];
    expect(context.sources).toHaveLength(0);
    context.currentTime = 2;
    first.resolve(pcm(5));
    await settle();
    expect(context.sources[0].start).toHaveBeenCalledWith(2.035, 0, 5);
    expect(context.sources[1].start).toHaveBeenCalledWith(7.035, 0, 7);
    expect(test.errors).not.toHaveBeenCalled();
  });
  it("seeks the master through source offsets and computes its cursor from the audio clock", async () => {
    const original = source();
    let p = splitSegment(original, original.segments[0].id, 5);
    p = trimSegment(p, p.segments[0].id, 1, 3);
    p = trimSegment(p, p.segments[1].id, 7, 10);
    const test = runner(p);
    test.render().playMaster(2.5);
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice).toHaveBeenCalledWith("a", 7.5, 10, 1);
    context.currentTime = 0.535;
    tick();
    expect(test.render().position).toBeCloseTo(3);
    context.sources[0].finish();
    expect(test.render().playing).toBe(false);
    expect(test.render().position).toBe(0);
  });
  it("discards a stale decode after another preview starts", async () => {
    const p = source();
    const slow = deferred();
    audioSlice.mockReturnValueOnce(slow.promise);
    const test = runner(p);
    test.render().preview(p.segments[0]);
    await settle();
    const next = {
      ...p.segments[0],
      id: "different-preview",
      start: 6,
      end: 8,
    };
    test.render().preview(next);
    await settle();
    slow.resolve(pcm(12));
    await settle();
    expect(TestContext.instances[0].sources).toHaveLength(1);
    expect(test.render().previewId).toBe(next.id);
    expect(test.render().playing).toBe(true);
    expect(test.errors).not.toHaveBeenCalled();
  });
  it("ignores a stale lookahead failure after another take starts", async () => {
    const original = source();
    const p = splitSegment(original, original.segments[0].id, 5);
    const second = deferred();
    audioSlice.mockImplementation((_id, start, end) =>
      start === 5 ? second.promise : Promise.resolve(pcm(end - start)),
    );
    const test = runner(p);
    test.render().previewMany(p.segments);
    await settle();
    const next = { ...p.segments[0], id: "new-take", start: 1, end: 3 };
    test.render().preview(next);
    await settle();
    second.reject(new Error("An obsolete lookahead failed."));
    await settle();
    expect(test.render().previewId).toBe(next.id);
    expect(test.render().playing).toBe(true);
    expect(test.errors).not.toHaveBeenCalled();
  });
  it("limits visual updates while continuing to read the audio clock", async () => {
    const test = runner(source());
    test.render().playMaster();
    await settle();
    const context = TestContext.instances[0];
    context.currentTime = 0.535;
    tick();
    expect(test.render().position).toBeCloseTo(0.5);
    context.currentTime = 0.545;
    tick();
    expect(test.render().position).toBeCloseTo(0.5);
    context.currentTime = 0.575;
    tick();
    expect(test.render().position).toBeCloseTo(0.54);
  });
  it("captures the audio clock on pause between visual updates", async () => {
    const test = runner(source());
    test.render().playMaster();
    await settle();
    const context = TestContext.instances[0];
    context.currentTime = 0.535;
    tick();
    context.currentTime = 0.55;
    test.render().stop();
    expect(test.render().position).toBeCloseTo(0.515);
    test.render().playMaster();
    await settle();
    expect(audioSlice).toHaveBeenLastCalledWith("a", 0.515, 12, 1);
  });
  it("reports current decode errors and suppresses stale failures after stopping", async () => {
    const p = source();
    const slow = deferred();
    audioSlice.mockReturnValueOnce(slow.promise);
    const test = runner(p);
    test.render().preview(p.segments[0]);
    await settle();
    test.render().stop();
    slow.reject(new Error("Old cancelled request."));
    await settle();
    expect(test.errors).not.toHaveBeenCalled();
    audioSlice.mockRejectedValueOnce(
      new Error("This media could not be decoded."),
    );
    test.render().preview(p.segments[0]);
    await settle();
    expect(test.errors).toHaveBeenCalledWith(
      "This media could not be decoded.",
    );
    expect(test.render().playing).toBe(false);
  });
  it("coalesces rapid active scrubbing so it does not flood local decoders", async () => {
    vi.useFakeTimers();
    const test = runner(source());
    test.render().playMaster();
    await settle();
    audioSlice.mockClear();
    test.render().seek(1);
    test.render().seek(2);
    test.render().seek(3);
    expect(audioSlice).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(audioSlice).toHaveBeenCalledTimes(1);
    expect(audioSlice).toHaveBeenCalledWith("a", 3, 12, 1);
  });
  it("buffers a slow lookahead without skipping the next section", async () => {
    const original = source();
    let p = splitSegment(original, original.segments[0].id, 4);
    p = splitSegment(p, p.segments[1].id, 8);
    const slow = deferred();
    audioSlice.mockImplementation((_id, start, end) =>
      start === 8 ? slow.promise : Promise.resolve(pcm(end - start)),
    );
    const test = runner(p);
    test.render().previewMany(p.segments);
    await settle();
    const context = TestContext.instances[0];
    expect(context.sources).toHaveLength(2);
    context.currentTime = 4.035;
    context.sources[0].finish();
    context.currentTime = 8.035;
    context.sources[1].finish();
    expect(test.render().preparing).toBe(true);
    context.currentTime = 10;
    slow.resolve(pcm(4));
    await settle();
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2].start).toHaveBeenCalledWith(10.015, 0, 4);
    expect(test.render().preparing).toBe(false);
  });
  it("reuses a decoded range when a take is previewed again", async () => {
    const p = source();
    const test = runner(p);
    test.render().preview(p.segments[0]);
    await settle();
    test.render().stop();
    test.render().preview(p.segments[0]);
    await settle();
    expect(audioSlice).toHaveBeenCalledTimes(1);
    expect(TestContext.instances[0].sources).toHaveLength(2);
  });
  it("stops scheduled nodes and closes the context when unmounted", async () => {
    const test = runner(source());
    test.render().playMaster();
    await settle();
    const context = TestContext.instances[0];
    hooks.cleanup.forEach((cleanup) => cleanup());
    hooks.cleanup = [];
    expect(context.sources[0].stop).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
