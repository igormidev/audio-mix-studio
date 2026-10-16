import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendTracks,
  masterClips,
  newProject,
  splitSegment,
  trimSegment,
} from "../src/domain/project";
import type { MixProject } from "../src/shared/types";
import {
  deinterleavePCM,
  edgeFadeSeconds,
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
    (trackId: string, start: number, end: number) => Promise<ArrayBuffer>
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
  audioSlice.mockImplementation((_track, start, end) =>
    Promise.resolve(pcm(end - start)),
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
  it("previews exact trimmed source ranges and leaves the master cursor alone", async () => {
    const original = source();
    const p = trimSegment(original, original.segments[0].id, 2, 4);
    const test = runner(p);
    test.render().seek(0.7);
    test.render().preview(p.segments[0]);
    await settle();
    const context = TestContext.instances[0];
    expect(audioSlice).toHaveBeenCalledWith("a", 2, 4);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 2);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      0.043000000000000003,
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
      ["a", 1, 3],
      ["a", 7, 10],
    ]);
    expect(context.sources[0].start).toHaveBeenCalledWith(0.035, 0, 2);
    expect(context.sources[1].start).toHaveBeenCalledWith(2.035, 0, 3);
    context.currentTime = 20;
    expect(context.sources).toHaveLength(2); // Audio source scheduling is independent of RAF.
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
    expect(audioSlice).toHaveBeenCalledWith("a", 7.5, 10);
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
    expect(audioSlice).toHaveBeenCalledWith("a", 3, 12);
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
