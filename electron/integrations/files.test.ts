import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile, verifiedFile } from "./files";

describe("pinned model/runtime downloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes only checksum-verified content and reuses the completed file offline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audio-mix-download-test-"));
    try {
      const bytes = Buffer.from("pinned model bytes");
      const record = {
        url: "https://example.invalid/model",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(bytes));
      const target = join(directory, "model.bin");
      const signal = new AbortController().signal;
      await downloadFile(target, record, signal, () => undefined);
      expect(await readFile(target)).toEqual(bytes);
      expect(await verifiedFile(target, record, signal)).toBe(true);
      await downloadFile(target, record, signal, () => undefined);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await readdir(directory)).toEqual(["model.bin"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects corruption without replacing existing content or leaving a partial file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audio-mix-download-test-"));
    try {
      const expected = Buffer.from("good");
      const target = join(directory, "model.bin");
      await writeFile(target, "old");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(Buffer.from("evil")),
      );
      const record = {
        url: "https://example.invalid/model",
        size: expected.length,
        sha256: createHash("sha256").update(expected).digest("hex"),
      };
      await expect(
        downloadFile(
          target,
          record,
          new AbortController().signal,
          () => undefined,
        ),
      ).rejects.toThrow(/integrity/);
      expect(await readFile(target, "utf8")).toBe("old");
      expect(await readdir(directory)).toEqual(["model.bin"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
