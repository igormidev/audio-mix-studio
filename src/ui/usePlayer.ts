import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioSegment, MasterClip, MixProject } from "../shared/types";
import { mixDuration } from "../domain/soundMix";
import {
  deinterleavePCM,
  chunkGainEnvelope,
  PCM_SAMPLE_RATE,
  planPlayback,
  type PlaybackChunk,
  type PlaybackItem,
} from "./playback";

interface ScheduledChunk {
  gain: GainNode;
  chunk: PlaybackChunk;
  start: number;
  duration: number;
}
const MAX_CACHE_BYTES = 96 * 1024 * 1024;

/** Sample-accurate audio scheduling; animation frames only move the visual cursor. */
export function usePlayer(
  project: MixProject,
  clips: MasterClip[],
  onError: (text: string) => void,
) {
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [position, setPosition] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const context = useRef<AudioContext | null>(null);
  const sources = useRef(new Map<AudioBufferSourceNode, ScheduledChunk>());
  const buffers = useRef(new Map<string, AudioBuffer>());
  const pending = useRef(new Map<string, Promise<AudioBuffer>>());
  const cacheBytes = useRef(0);
  const frame = useRef(0);
  const generation = useRef(0);
  const positionRef = useRef(0);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterSeek = useRef(false);
  const session = useRef<{ active: boolean; preview: string | null }>({
    active: false,
    preview: null,
  });
  const mixedSession = useRef(false);
  const mixCacheIdentity = useRef<{
    project: MixProject | null;
    revision: number;
  }>({ project: null, revision: 0 });
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  const clockPosition = useCallback(() => {
    const now = context.current?.currentTime ?? 0;
    let value = positionRef.current;
    for (const scheduled of sources.current.values()) {
      if (now >= scheduled.start)
        value = Math.max(
          value,
          scheduled.chunk.offset +
            Math.min(scheduled.duration, now - scheduled.start),
        );
    }
    return value;
  }, []);

  const stop = useCallback(() => {
    if (session.current.active && session.current.preview === null) {
      positionRef.current = clockPosition();
      setPosition(positionRef.current);
    }
    generation.current++;
    if (session.current.active || mixedSession.current) {
      void window.studio.cancelPlayback?.(project.id).catch(() => undefined);
      mixedSession.current = false;
      pending.current.clear();
    }
    if (seekTimer.current) clearTimeout(seekTimer.current);
    seekTimer.current = null;
    resumeAfterSeek.current = false;
    session.current = { active: false, preview: null };
    for (const [source, scheduled] of sources.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* The source may have just finished. */
      }
      source.disconnect();
      scheduled.gain.disconnect();
    }
    sources.current.clear();
    cancelAnimationFrame(frame.current);
    setPlaying(false);
    setPreparing(false);
    setPreviewId(null);
  }, [clockPosition, project.id]);

  const playItems = useCallback(
    async (
      items: PlaybackItem[],
      from: number,
      preview: string | null,
      mixedProject?: MixProject,
    ) => {
      stop();
      const run = generation.current;
      try {
        const plan = planPlayback(items, from, mixedProject ? 20 : undefined);
        if (mixedProject) {
          mixedSession.current = true;
          if (mixCacheIdentity.current.project !== mixedProject)
            mixCacheIdentity.current = {
              project: mixedProject,
              revision: mixCacheIdentity.current.revision + 1,
            };
          const identity = `${mixedProject.id}:${mixCacheIdentity.current.revision}`;
          plan.forEach((chunk) => {
            chunk.key = `${identity}:${chunk.start}:${chunk.end}`;
          });
        }
        if (!plan.length) return;
        session.current = { active: true, preview };
        setPlaying(true);
        setPreparing(true);
        setPreviewId(preview);
        const audio =
          context.current ??
          new AudioContext({
            sampleRate: PCM_SAMPLE_RATE,
            latencyHint: "interactive",
          });
        context.current = audio;
        // Resume during the initiating gesture, before waiting on the local decoder.
        await audio.resume();
        if (run !== generation.current) return;

        const decode = (chunk: PlaybackChunk): Promise<AudioBuffer> => {
          if (chunk.silent)
            return Promise.resolve(
              audio.createBuffer(
                2,
                Math.max(1, Math.round(chunk.duration * PCM_SAMPLE_RATE)),
                PCM_SAMPLE_RATE,
              ),
            );
          const hit = buffers.current.get(chunk.key);
          if (hit) {
            buffers.current.delete(chunk.key);
            buffers.current.set(chunk.key, hit);
            return Promise.resolve(hit);
          }
          const existing = pending.current.get(chunk.key);
          if (existing) return existing;
          const decoded = mixedProject
            ? window.studio.mixSlice(mixedProject, chunk.start, chunk.end)
            : window.studio.audioSlice(
                chunk.trackId,
                chunk.start,
                chunk.end,
                chunk.speed ?? 1,
                chunk.logicalSource,
                project.id,
              );
          const request = decoded
            .then((bytes) => {
              const [left, right] = deinterleavePCM(bytes);
              if (left.length / PCM_SAMPLE_RATE < chunk.duration - 0.001)
                throw new Error(
                  "The audio decoder returned an incomplete section. Try importing this take again.",
                );
              const buffer = audio.createBuffer(
                2,
                left.length,
                PCM_SAMPLE_RATE,
              );
              buffer.copyToChannel(left, 0);
              buffer.copyToChannel(right, 1);
              const size = left.length * 8;
              while (
                buffers.current.size &&
                cacheBytes.current + size > MAX_CACHE_BYTES
              ) {
                const oldest = buffers.current.keys().next().value!;
                const removed = buffers.current.get(oldest)!;
                cacheBytes.current -=
                  removed.length * removed.numberOfChannels * 4;
                buffers.current.delete(oldest);
              }
              buffers.current.set(chunk.key, buffer);
              cacheBytes.current += size;
              return buffer;
            })
            .finally(() => {
              if (pending.current.get(chunk.key) === request)
                pending.current.delete(chunk.key);
            });
          pending.current.set(chunk.key, request);
          return request;
        };

        // Prepare a bounded lookahead, but do not make the first section wait
        // for a slower second decode before it can begin playing.
        const prepared = new Map<number, AudioBuffer>();
        const decoding = new Set<number>();
        let nextIndex = 0;
        let nextStart: number | null = null;
        const fail = (error: unknown) => {
          if (run !== generation.current) return;
          stop();
          errorHandler.current(
            error instanceof Error
              ? error.message
              : "Could not play this audio.",
          );
        };
        const finish = () => {
          stop();
          if (preview === null) {
            positionRef.current = 0;
            setPosition(0);
          }
        };
        const pump = () => {
          if (run !== generation.current) return;
          while (
            nextIndex < plan.length &&
            sources.current.size < 2 &&
            prepared.has(nextIndex)
          ) {
            const chunk = plan[nextIndex];
            const buffer = prepared.get(nextIndex)!;
            prepared.delete(nextIndex++);
            const duration = Math.min(chunk.duration, buffer.duration);
            // A decoder stall resumes at the next sample instead of skipping speech.
            const start = Math.max(
              nextStart ?? audio.currentTime + 0.035,
              audio.currentTime + 0.015,
            );
            const source = audio.createBufferSource();
            const gain = audio.createGain();
            source.buffer = buffer;
            source.connect(gain);
            gain.connect(audio.destination);
            const envelope = chunkGainEnvelope({ ...chunk, duration });
            envelope.forEach((point, index) => {
              if (index === 0)
                gain.gain.setValueAtTime(point.value, start + point.time);
              else
                gain.gain.linearRampToValueAtTime(
                  point.value,
                  start + point.time,
                );
            });
            sources.current.set(source, { gain, chunk, start, duration });
            source.onended = () => {
              sources.current.delete(source);
              source.disconnect();
              gain.disconnect();
              if (run !== generation.current) return;
              if (nextIndex === plan.length && !sources.current.size) finish();
              else pump();
            };
            source.start(start, 0, duration);
            nextStart = start + duration;
            setPreparing(false);
          }
          if (nextIndex < plan.length && !sources.current.size)
            setPreparing(true);
          // At most two scheduled sections and one decoded lookahead. A slow
          // lookahead never blocks an already prepared earlier section.
          const ahead = sources.current.size < 2 ? 2 : 1;
          for (
            let index = nextIndex;
            index < Math.min(plan.length, nextIndex + ahead);
            index++
          ) {
            if (prepared.has(index) || decoding.has(index)) continue;
            decoding.add(index);
            void decode(plan[index])
              .then((buffer) => {
                decoding.delete(index);
                if (run !== generation.current) return;
                prepared.set(index, buffer);
                pump();
              })
              .catch(fail);
          }
        };
        let lastVisualTime = Number.NEGATIVE_INFINITY;
        const tick = () => {
          if (run !== generation.current) return;
          // The audio clock remains sample-accurate. Updating the visual cursor
          // at 30 Hz avoids rerendering the editor on every display refresh.
          if (audio.currentTime - lastVisualTime >= 1 / 30) {
            const value = clockPosition();
            positionRef.current = value;
            setPosition(value);
            lastVisualTime = audio.currentTime;
          }
          frame.current = requestAnimationFrame(tick);
        };
        if (preview === null) {
          positionRef.current = from;
          setPosition(from);
        }
        pump();
        if (preview === null) frame.current = requestAnimationFrame(tick);
      } catch (error) {
        if (run === generation.current) {
          stop();
          errorHandler.current(
            error instanceof Error
              ? error.message
              : "Could not play this audio.",
          );
        }
      }
    },
    [stop, clockPosition, project.id],
  );

  const playMaster = useCallback(
    (from = positionRef.current) => {
      const duration = mixDuration(project);
      const at =
        !Number.isFinite(from) || from >= duration - 0.001
          ? 0
          : Math.max(0, from);
      if (project.soundMix?.placements.length)
        void playItems(
          [
            {
              id: "mixed-master",
              trackId: "mixed-master",
              start: 0,
              end: duration,
              offset: 0,
            },
          ],
          at,
          null,
          project,
        );
      else void playItems(clips, at, null);
    },
    [clips, playItems, project],
  );

  const previewMany = useCallback(
    (segments: AudioSegment[]) => {
      if (!segments.length) return;
      if (
        session.current.active &&
        session.current.preview === segments[0].id
      ) {
        stop();
        return;
      }
      // The row's first segment remains the preview identity even when that
      // segment is cut. Selection and exclusion are independent: alternatives
      // can be previewed without becoming selected, but excluded audio stays out.
      const previewIdentity = segments[0].id;
      const audible = segments.flatMap((segment) => {
        if (segment.excluded) return [];
        const speed =
          project.groups.find((group) => group.id === segment.groupId)?.speed ??
          1;
        const duration =
          Math.round(
            (Math.round(segment.end * PCM_SAMPLE_RATE) -
              Math.round(segment.start * PCM_SAMPLE_RATE)) /
              speed,
          ) / PCM_SAMPLE_RATE;
        return duration > 0 ? [{ segment, speed, duration }] : [];
      });
      if (!audible.length) {
        stop();
        return;
      }
      let offset = 0;
      const items = audible.map(({ segment, speed, duration }, index) => {
        const groupClips = clips.filter(
          (clip) => clip.groupId === segment.groupId,
        );
        const item = {
          ...segment,
          offset,
          speed,
          duration,
          fadeInMs: index === 0 ? (groupClips[0]?.fadeInMs ?? 0) : 0,
          fadeOutMs:
            index === audible.length - 1
              ? (groupClips[groupClips.length - 1]?.fadeOutMs ?? 0)
              : 0,
        };
        offset += duration;
        return item;
      });
      void playItems(items, 0, previewIdentity);
    },
    [playItems, stop, project.groups, clips],
  );
  const preview = useCallback(
    (segment: AudioSegment) => previewMany([segment]),
    [previewMany],
  );
  const seek = useCallback(
    (value: number) => {
      const wasPlaying =
        (session.current.active && session.current.preview === null) ||
        resumeAfterSeek.current;
      const duration = mixDuration(project);
      const at = Math.max(
        0,
        Math.min(duration, Number.isFinite(value) ? value : 0),
      );
      stop();
      positionRef.current = at;
      setPosition(at);
      if (wasPlaying) {
        resumeAfterSeek.current = true;
        seekTimer.current = setTimeout(() => {
          seekTimer.current = null;
          resumeAfterSeek.current = false;
          playMaster(at);
        }, 100);
      }
    },
    [project, stop, playMaster],
  );

  useEffect(
    () => () => {
      generation.current++;
      if (session.current.active || mixedSession.current)
        void window.studio.cancelPlayback?.(project.id).catch(() => undefined);
      if (seekTimer.current) clearTimeout(seekTimer.current);
      for (const [source, scheduled] of sources.current) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* Already ended. */
        }
        source.disconnect();
        scheduled.gain.disconnect();
      }
      sources.current.clear();
      buffers.current.clear();
      cacheBytes.current = 0;
      cancelAnimationFrame(frame.current);
      void context.current?.close().catch(() => undefined);
      context.current = null;
    },
    [project.id],
  );
  return {
    playing,
    preparing,
    position,
    previewId,
    stop,
    playMaster,
    preview,
    previewMany,
    seek,
  };
}
