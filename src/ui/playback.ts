export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PLAYBACK_CHUNK_SECONDS = 60;

export interface PlaybackItem {
  id: string;
  trackId: string;
  start: number;
  end: number;
  offset: number;
  speed?: number;
  duration?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}
export interface PlaybackChunk extends PlaybackItem {
  key: string;
  duration: number;
  fadeIn: boolean;
  fadeOut: boolean;
  silent?: boolean;
  clipOffset?: number;
  clipDuration?: number;
  logicalSource?: { start: number; end: number };
}

/** Exact sample boundaries. Internal chunks add no fades or silent gaps. */
export function planPlayback(
  items: PlaybackItem[],
  from = 0,
  chunkSeconds = PLAYBACK_CHUNK_SECONDS,
): PlaybackChunk[] {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(chunkSeconds) ||
    chunkSeconds <= 0 ||
    chunkSeconds > 120
  )
    throw new Error("Invalid playback position or chunk length.");
  const chunks: PlaybackChunk[] = [];
  let offset = Math.max(0, from);
  for (const item of items) {
    if (
      ![item.start, item.end, item.offset].every(Number.isFinite) ||
      item.start < 0 ||
      item.end <= item.start ||
      item.offset < 0
    )
      throw new Error("The selected audio has invalid playback timestamps.");
    const speed = item.speed ?? 1;
    if (
      !Number.isFinite(speed) ||
      speed < 0.5 ||
      speed > 2.5 ||
      Math.abs(speed * 100 - Math.round(speed * 100)) > 0.000001
    )
      throw new Error("Invalid sentence speed.");
    const sourceStart = Math.round(item.start * PCM_SAMPLE_RATE);
    const endFrame = Math.round(item.end * PCM_SAMPLE_RATE);
    const outputDuration =
      Math.round((endFrame - sourceStart) / speed) / PCM_SAMPLE_RATE;
    if (item.offset + outputDuration <= from) continue;
    // Explicit silence is part of the same output clock as the audio clips.
    if (item.offset > offset) {
      const duration = item.offset - offset;
      chunks.push({
        id: `pause-${item.id}`,
        trackId: item.trackId,
        key: `silence:${Math.round(duration * PCM_SAMPLE_RATE)}`,
        start: 0,
        end: duration,
        offset,
        duration,
        fadeIn: false,
        fadeOut: false,
        silent: true,
        speed: 1,
      });
      offset += duration;
    }
    const skipped = Math.max(0, from - item.offset);
    const firstFrame = Math.round(
      (item.start + skipped * speed) * PCM_SAMPLE_RATE,
    );
    // Multiples of the speed numerator produce integer output-frame counts.
    // This keeps chunked playback duration equal to a single FFmpeg export.
    const speedPercent = Math.round(speed * 100);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const numerator = speedPercent / gcd(speedPercent, 100);
    const requestedFrames = Math.min(
      60 * PCM_SAMPLE_RATE,
      chunkSeconds * PCM_SAMPLE_RATE * speed,
    );
    const maxFrames = Math.max(
      numerator,
      Math.floor(requestedFrames / numerator) * numerator,
    );
    for (let frame = firstFrame; frame < endFrame; frame += maxFrames) {
      const until = Math.min(endFrame, frame + maxFrames);
      const duration = Math.round((until - frame) / speed) / PCM_SAMPLE_RATE;
      const clipOffset =
        skipped + (frame - firstFrame) / PCM_SAMPLE_RATE / speed;
      chunks.push({
        id: item.id,
        trackId: item.trackId,
        key: `${item.trackId}:${frame}:${until}:${speed}:${sourceStart}:${endFrame}`,
        start: frame / PCM_SAMPLE_RATE,
        end: until / PCM_SAMPLE_RATE,
        offset,
        duration,
        fadeIn: frame === firstFrame,
        fadeOut: until === endFrame,
        speed,
        fadeInMs: item.fadeInMs ?? 0,
        fadeOutMs: item.fadeOutMs ?? 0,
        clipOffset,
        clipDuration: outputDuration,
        ...(speed !== 1 && (frame !== sourceStart || until !== endFrame)
          ? { logicalSource: { start: item.start, end: item.end } }
          : {}),
      });
      offset += duration;
    }
  }
  return chunks;
}

/** Gain breakpoints across an entire logical clip, including chunk boundaries. */
export function chunkGainEnvelope(
  chunk: PlaybackChunk,
): { time: number; value: number }[] {
  const duration = chunk.clipDuration ?? chunk.duration;
  const offset = chunk.clipOffset ?? 0;
  const requestedIn = Math.max(0, Math.min(5000, chunk.fadeInMs ?? 0)) / 1000;
  const requestedOut = Math.max(0, Math.min(5000, chunk.fadeOutMs ?? 0)) / 1000;
  const factor =
    requestedIn + requestedOut > duration
      ? duration / (requestedIn + requestedOut)
      : 1;
  const fadeIn = requestedIn * factor;
  const fadeOut = requestedOut * factor;
  const gain = (time: number) =>
    Math.max(
      0,
      Math.min(
        1,
        fadeIn ? time / fadeIn : 1,
        fadeOut ? (duration - time) / fadeOut : 1,
      ),
    );
  const times = [
    0,
    chunk.duration,
    fadeIn - offset,
    duration - fadeOut - offset,
  ]
    .filter((time) => time >= 0 && time <= chunk.duration)
    .sort((a, b) => a - b);
  return [...new Set(times)].map((time) => ({
    time,
    value: gain(offset + time),
  }));
}

/** IPC audio is interleaved float32 little-endian stereo at 48 kHz. */
export function deinterleavePCM(
  bytes: ArrayBuffer,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  if (
    !(bytes instanceof ArrayBuffer) ||
    !bytes.byteLength ||
    bytes.byteLength % (4 * PCM_CHANNELS) ||
    bytes.byteLength > PCM_SAMPLE_RATE * 120 * PCM_CHANNELS * 4
  )
    throw new Error("The audio decoder returned invalid PCM data.");
  const frames = bytes.byteLength / (4 * PCM_CHANNELS);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const view = new DataView(bytes);
  for (let frame = 0; frame < frames; frame++) {
    const a = view.getFloat32(frame * 8, true);
    const b = view.getFloat32(frame * 8 + 4, true);
    if (!Number.isFinite(a) || !Number.isFinite(b))
      throw new Error("The audio decoder returned invalid samples.");
    left[frame] = a;
    right[frame] = b;
  }
  return [left, right];
}

export function edgeFadeSeconds(
  chunk: PlaybackChunk,
  milliseconds: number,
): { fadeIn: number; fadeOut: number } {
  const edge = Math.min(
    Math.max(0, Math.min(20, milliseconds)) / 1000,
    chunk.duration / 2,
  );
  return { fadeIn: chunk.fadeIn ? edge : 0, fadeOut: chunk.fadeOut ? edge : 0 };
}
