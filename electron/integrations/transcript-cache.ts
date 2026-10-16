import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Transcript, TranscriptionModel } from "../../src/shared/types";
import { resourcesDirectory } from "./runtime";

/** Exact media bytes, model and engine revisions form the cache identity. */
export async function transcriptCacheFile(
  directory: string,
  sourceHash: string,
  model: TranscriptionModel,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(sourceHash))
    throw new Error("Invalid audio fingerprint.");
  const resources = await resourcesDirectory();
  const revision = createHash("sha256")
    .update(await readFile(join(resources, "engine.py")))
    .update(await readFile(join(resources, "models.json")))
    .update(await readFile(join(resources, "macos-arm64.txt")))
    .digest("hex")
    .slice(0, 24);
  return join(
    directory,
    "transcripts",
    `${sourceHash}-${model}-${revision}.json`,
  );
}

export async function readCachedTranscript(
  file: string,
  duration: number,
  parse: (value: unknown) => Transcript,
): Promise<Transcript | null> {
  try {
    if ((await stat(file)).size > 32_000_000) return null;
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("duration" in value) ||
      value.duration !== duration ||
      !("transcript" in value)
    )
      return null;
    return parse(value.transcript);
  } catch {
    return null; /* Invalid/interrupted cache never blocks a fresh transcription. */
  }
}

export async function cacheTranscript(
  file: string,
  duration: number,
  transcript: Transcript,
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.partial`;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(
      temporary,
      JSON.stringify({ version: 1, duration, transcript }),
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporary, file);
  } catch {
    /* A disposable cache failure must not discard completed local inference. */
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
