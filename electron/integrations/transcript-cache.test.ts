import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transcript } from "../../src/shared/types";
import {
  cacheTranscript,
  readCachedTranscript,
  transcriptCacheFile,
} from "./transcript-cache";

describe("local inference recovery cache", () => {
  it("invalidates a transcript for different source bytes, model or duration", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "audio-mix-transcript-test-"),
    );
    try {
      const first = await transcriptCacheFile(
        directory,
        "a".repeat(64),
        "tiny",
      );
      expect(first).not.toBe(
        await transcriptCacheFile(directory, "b".repeat(64), "tiny"),
      );
      expect(first).not.toBe(
        await transcriptCacheFile(directory, "a".repeat(64), "large-v3-turbo"),
      );
      const transcript: Transcript = {
        model: "tiny",
        language: "en",
        segments: [{ start: 0, end: 1, text: "Hello." }],
        words: [],
      };
      await cacheTranscript(first, 1, transcript);
      expect(
        await readCachedTranscript(first, 1, (value) => value as Transcript),
      ).toEqual(transcript);
      expect(
        await readCachedTranscript(first, 2, (value) => value as Transcript),
      ).toBeNull();
      expect(JSON.parse(await readFile(first, "utf8"))).toHaveProperty(
        "version",
        1,
      );
      await writeFile(first, "{interrupted");
      expect(
        await readCachedTranscript(first, 1, (value) => value as Transcript),
      ).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
