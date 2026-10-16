export const PCM_SAMPLE_RATE = 48_000;
export const PCM_CHANNELS = 2;
export const PLAYBACK_CHUNK_SECONDS = 60;

export interface PlaybackItem {
  id: string;
  trackId: string;
  start: number;
  end: number;
  offset: number;
}
export interface PlaybackChunk extends PlaybackItem {
  key: string;
  duration: number;
  fadeIn: boolean;
  fadeOut: boolean;
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
  const maxFrames = Math.max(1, Math.round(chunkSeconds * PCM_SAMPLE_RATE));
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
    if (item.offset + item.end - item.start <= from) continue;
    const firstFrame = Math.round(
      (item.start + Math.max(0, from - item.offset)) * PCM_SAMPLE_RATE,
    );
    const endFrame = Math.round(item.end * PCM_SAMPLE_RATE);
    for (let frame = firstFrame; frame < endFrame; frame += maxFrames) {
      const until = Math.min(endFrame, frame + maxFrames);
      const duration = (until - frame) / PCM_SAMPLE_RATE;
      chunks.push({
        id: item.id,
        trackId: item.trackId,
        key: `${item.trackId}:${frame}:${until}`,
        start: frame / PCM_SAMPLE_RATE,
        end: until / PCM_SAMPLE_RATE,
        offset,
        duration,
        fadeIn: frame === firstFrame,
        fadeOut: until === endFrame,
      });
      offset += duration;
    }
  }
  return chunks;
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
