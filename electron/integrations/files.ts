// Runtime bootstrap and bounded wheel extraction adapted from Vandashi (MIT).
// Copyright (c) 2026 Igor. See resources/transcription/VANDASHI-LICENSE.txt.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { inflateRawSync } from "node:zlib";

export interface DownloadRecord {
  url: string;
  size: number;
  sha256: string;
}
const verification = new Map<string, string>();

export async function digest(
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path, { signal }))
    hash.update(bytes as Buffer);
  signal.throwIfAborted();
  return hash.digest("hex");
}

export async function verifiedFile(
  path: string,
  record: Pick<DownloadRecord, "size" | "sha256">,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size !== record.size) return false;
    const identity = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${record.sha256}`;
    if (verification.get(path) === identity) return true;
    if ((await digest(path, signal)) !== record.sha256) return false;
    verification.set(path, identity);
    return true;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function downloadFile(
  path: string,
  record: DownloadRecord,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<void> {
  if (await verifiedFile(path, record, signal)) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.${randomUUID()}.partial`;
  try {
    const response = await fetch(record.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1_800_000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Download failed (HTTP ${response.status}). Please try again.`,
      );
    const handle = await open(partial, "wx", 0o600);
    const reader = response.body.getReader();
    let received = 0;
    const hash = createHash("sha256");
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const bytes = next.value;
        signal.throwIfAborted();
        received += bytes.byteLength;
        if (received > record.size)
          throw new Error("Download exceeds its expected size.");
        hash.update(bytes);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = await handle.write(
            bytes,
            offset,
            bytes.byteLength - offset,
          );
          if (written.bytesWritten <= 0)
            throw new Error(
              "Could not write download. Check available disk space.",
            );
          offset += written.bytesWritten;
        }
        progress(received / record.size);
      }
      if (received !== record.size || hash.digest("hex") !== record.sha256)
        throw new Error(
          "Downloaded file failed its integrity check. Please try again.",
        );
      await handle.sync();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      await handle.close();
    }
    signal.throwIfAborted();
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Extract just the expected executable from a checksum-verified wheel. */
export function wheelExecutable(archive: Buffer, name: string): Buffer {
  for (let cursor = 0; cursor + 46 <= archive.length; cursor++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(cursor + 28);
    if (
      archive.subarray(cursor + 46, cursor + 46 + nameLength).toString() !==
      name
    )
      continue;
    const size = archive.readUInt32LE(cursor + 20);
    const expanded = archive.readUInt32LE(cursor + 24);
    const local = archive.readUInt32LE(cursor + 42);
    if (
      expanded > 100_000_000 ||
      local + 30 > archive.length ||
      archive.readUInt32LE(local) !== 0x04034b50
    )
      break;
    const start =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28);
    if (start + size > archive.length) break;
    const bytes = archive.subarray(start, start + size);
    const method = archive.readUInt16LE(cursor + 10);
    const result =
      method === 0
        ? bytes
        : method === 8
          ? inflateRawSync(bytes, { maxOutputLength: 100_000_000 })
          : null;
    if (result && result.length === expanded) return result;
    break;
  }
  throw new Error("The downloaded runtime archive is invalid.");
}
