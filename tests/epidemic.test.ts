import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  rename,
  chmod,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EpidemicError,
  boundedEpidemicResponse,
  EpidemicService,
  checkedEpidemicAsset,
  checkedEpidemicSearch,
  checkedEpidemicURL,
  epidemicSearchArguments,
  epidemicToolData,
  type EpidemicCall,
} from "../electron/epidemic";
import { MediaStore, findBinary, runProcess } from "../electron/media";
import { newProject, parseProject } from "../src/domain/project";
import type { AudioTrack } from "../src/shared/types";

const sourceId = "123e4567-e89b-12d3-a456-426614174000";
const audioId = "123e4567-e89b-12d3-a456-426614174001";
const key = "test-credential-never-a-real-key-12345678";
const otherKey = "replacement-credential-not-a-real-key-123456";
const payload = (data: unknown) => ({
  content: [{ type: "text", text: JSON.stringify({ data }) }],
});
const verification = () => payload({ recordings: { nodes: [] } });
const audio: AudioTrack = {
  id: audioId,
  name: "Prepared track",
  duration: 2,
  color: "#336699",
  peaks: [0.2, 0.4],
  mediaUrl: `mixmedia://audio/${audioId}`,
};
const cipher = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decrypt: (value: Buffer) => value.toString().split("").reverse().join(""),
};
const recording = () => ({
  id: sourceId,
  title: "Generated example",
  bpm: 100,
  coverArtUrl: "https://cdn.epidemicsound.com/cover.png",
  audioFile: {
    durationInMilliseconds: 2000,
    lqmp3Url: "https://audiocdn.epidemicsound.com/example.mp3",
  },
  credits: [
    {
      role: "MAIN_ARTIST",
      artist: { name: "Example Artist", slug: "example-artist" },
    },
  ],
  tags: [{ displayName: "Jazz", dimension: { name: "genre" } }],
  stems: [],
});
const searchResponse = () =>
  payload({
    recordings: {
      nodes: [{ recording: recording() }],
      meta: { total: 1 },
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  });
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mixstudio-epidemic-test-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
function service(
  call: EpidemicCall = async () => verification(),
  media = {} as MediaStore,
) {
  return new EpidemicService(directory, media, cipher, call);
}

describe("Epidemic request and response boundaries", () => {
  it("rejects unknown fields, invalid kinds, IDs, filter ranges, and unsupported SFX filters", () => {
    for (const input of [
      { kind: "music", url: "https://evil.invalid" },
      { kind: "voiceover" },
      { kind: "music", bpmMin: 120, bpmMax: 80 },
      { kind: "music", durationMin: NaN },
      { kind: "music", first: 1.5 },
      { kind: "music", genres: ["bad slug"] },
      { kind: "music", taxonomyMatch: "X" },
      { kind: "soundtrack", bpmMin: 10 },
      { kind: "soundtrack", sort: "BPM" },
      { kind: "soundtrack", topic: "cinematic" },
      { kind: "music", term: "jazz", topic: "quiet" },
    ])
      expect(() => checkedEpidemicSearch(input)).toThrow();
    for (const input of [
      { kind: "music", id: "../../private" },
      { kind: "music", id: sourceId, stem: "VOCALS" },
      { kind: "soundtrack", id: sourceId, stem: "BASS" },
      { kind: "music", id: sourceId, format: "exe" },
    ])
      expect(() => checkedEpidemicAsset(input)).toThrow();
  });
  it("maps all filters with exact units and AND semantics across taxonomy dimensions", () => {
    const request = checkedEpidemicSearch({
      kind: "music",
      genres: ["jazz"],
      decades: ["1950s"],
      countries: ["france"],
      moods: ["laid-back"],
      instruments: ["acoustic-guitar"],
      musicalKeys: ["c-minor"],
      tags: ["rare"],
      artistSlugs: ["example-artist"],
      vocals: "instrumental",
      bpmMin: 80,
      bpmMax: 120,
      durationMin: 3.25,
      durationMax: 20,
      sort: "BPM",
      order: "ASCENDING",
    });
    expect(epidemicSearchArguments(request)).toMatchObject({
      filter: {
        taxonomySlugs: {
          matchType: "ALL",
          values: ["jazz", "1950s", "france"],
        },
        moodSlugs: { matchType: "ANY", values: ["laid-back"] },
        featuredInstrumentSlugs: {
          matchType: "ANY",
          values: ["acoustic-guitar"],
        },
        musicalKeys: ["c-minor"],
        vocals: false,
        bpm: { min: 80, max: 120 },
        duration: { min: 3250, max: 20000 },
      },
      sort: { by: "BPM", order: "ASCENDING" },
    });
    expect(
      epidemicSearchArguments({
        ...request,
        taxonomyMatch: "NOT_ANY",
        moodMatch: "ALL",
      }),
    ).toMatchObject({
      filter: {
        taxonomySlugs: { matchType: "NOT_ANY" },
        moodSlugs: { matchType: "ALL" },
      },
    });
  });
  it("rejects unapproved media destinations, credentials, ports, and non-HTTPS URLs", () => {
    for (const value of [
      "http://audiocdn.epidemicsound.com/a.mp3",
      "https://audiocdn.epidemicsound.com.evil.invalid/a",
      "https://localhost/a",
      "file:///private/file",
      "https://secret:token@audiocdn.epidemicsound.com/a",
      "https://audiocdn.epidemicsound.com:444/a",
    ])
      expect(() => checkedEpidemicURL(value)).toThrow();
    expect(
      checkedEpidemicURL(
        "https://audiocdn.epidemicsound.com/a.mp3?signature=private",
      ).hostname,
    ).toBe("audiocdn.epidemicsound.com");
  });
  it("rejects invalid JSON and surfaces provider retry intervals without shortening them", () => {
    expect(() =>
      epidemicToolData({ content: [{ type: "text", text: "not json" }] }),
    ).toThrow(/invalid JSON/);
    try {
      epidemicToolData(
        payload({
          errors: [
            { extensions: { code: "RETRY_LATER", retryAfterSeconds: 7200 } },
          ],
        }),
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EpidemicError);
      expect((error as EpidemicError).retryAfterSeconds).toBe(7200);
    }
    expect(() =>
      epidemicToolData({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              errors: [
                {
                  message: `Authorization Bearer ${key}`,
                  extensions: { code: "FORBIDDEN" },
                },
              ],
            }),
          },
        ],
      }),
    ).toThrow(/subscription/);
  });
});

describe("verified credential persistence", () => {
  it("verifies before saving, stores encrypted bytes with private permissions, and restores without exposing a key", async () => {
    const called: string[] = [];
    const host = service(async (supplied, name) => {
      called.push(name);
      expect(supplied).toBe(key);
      return verification();
    });
    expect(host.status().connected).toBe(false);
    const state = await host.connect(key, new AbortController().signal);
    expect(called).toEqual(["__verify"]);
    expect(state).toMatchObject({ connected: true, secureStorage: true });
    expect(Object.keys(state)).not.toContain("key");
    const filename = path.join(directory, "epidemic-credentials.json");
    expect(await readFile(filename, "utf8")).not.toContain(key);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    const restored = service();
    await restored.initialize();
    expect(restored.status()).toEqual(state);
  });
  it("preserves the last working credential after invalid replacement or cancelled verification", async () => {
    const host = service(async (supplied) => {
      if (supplied === otherKey)
        throw new EpidemicError("This key was not accepted.", "UNAUTHORIZED");
      return verification();
    });
    await host.connect(key, new AbortController().signal);
    const before = await readFile(
      path.join(directory, "epidemic-credentials.json"),
      "utf8",
    );
    await expect(
      host.connect(otherKey, new AbortController().signal),
    ).rejects.toThrow(/not accepted/);
    expect(host.status().connected).toBe(true);
    expect(
      await readFile(path.join(directory, "epidemic-credentials.json"), "utf8"),
    ).toBe(before);
    const controller = new AbortController();
    controller.abort();
    await expect(host.connect(key, controller.signal)).rejects.toThrow();
    expect(
      await readFile(path.join(directory, "epidemic-credentials.json"), "utf8"),
    ).toBe(before);
  });
  it("handles corrupted credentials without replacing the saved bytes or breaking startup", async () => {
    const filename = path.join(directory, "epidemic-credentials.json");
    await writeFile(filename, "{broken");
    const host = service();
    await host.initialize();
    expect(host.status().connected).toBe(false);
    expect(await readFile(filename, "utf8")).toBe("{broken");
  });
  it("supports session-only verification without ever saving plaintext if OS encryption is unavailable", async () => {
    const host = new EpidemicService(
      directory,
      {} as MediaStore,
      { ...cipher, available: () => false },
      async () => verification(),
    );
    expect(await host.connect(key, new AbortController().signal)).toMatchObject(
      { connected: true, secureStorage: false },
    );
    expect(await readdir(directory)).toEqual([]);
    await host.disconnect();
    expect(host.status().connected).toBe(false);
  });
  it("a newer connection wins even when an older verification finishes later", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = service(async (supplied) => {
      if (supplied === key) await pending;
      return verification();
    });
    const old = host.connect(key, new AbortController().signal);
    await host.connect(otherKey, new AbortController().signal);
    release();
    await expect(old).rejects.toThrow(/newer connection/);
    const stored = JSON.parse(
      await readFile(path.join(directory, "epidemic-credentials.json"), "utf8"),
    );
    expect(cipher.decrypt(Buffer.from(stored.encrypted, "base64"))).toBe(
      otherKey,
    );
  });
});

describe("owned requests and authenticated audio import", () => {
  it("cancels only its own active request and suppresses late callbacks", async () => {
    const host = service();
    let resolve!: () => void;
    const pending = host.run(
      "one",
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new Error("cancelled")),
          );
          resolve = _resolve;
        }),
    );
    await Promise.resolve();
    const rejection = expect(pending).rejects.toThrow(/Cancelled/);
    host.cancel("one");
    await rejection;
    resolve();
    await expect(host.run("two", async () => "next")).resolves.toBe("next");
    await host.flush();
  });
  it("returns public metadata without preview URLs or credentials and enforces retry cooldown", async () => {
    let fail = false,
      calls = 0;
    const host = service(async (_key, name) => {
      calls++;
      if (name === "__verify") return verification();
      if (fail)
        return payload({
          errors: [
            { extensions: { code: "RETRY_LATER", retryAfterSeconds: 7200 } },
          ],
        });
      return searchResponse();
    });
    await host.connect(key, new AbortController().signal);
    const page = await host.search(
      { kind: "music" },
      new AbortController().signal,
    );
    expect(page.items[0]).toMatchObject({
      id: sourceId,
      artists: ["Example Artist"],
      artistFilters: [{ label: "Example Artist", value: "example-artist" }],
    });
    expect(JSON.stringify(page)).not.toContain("example.mp3");
    expect(JSON.stringify(page)).not.toContain(key);
    fail = true;
    await expect(
      host.search({ kind: "music" }, new AbortController().signal),
    ).rejects.toThrow(/7200/);
    const before = calls;
    await expect(
      host.search({ kind: "music" }, new AbortController().signal),
    ).rejects.toThrow(/Wait/);
    expect(calls).toBe(before);
  });
  it("imports real response shape into normalized media with preserved origin and cleans scratch files", async () => {
    let imported: Uint8Array | undefined;
    const media = {
      importAudio: async (file: string) => {
        imported = await readFile(file);
        return audio;
      },
    } as unknown as MediaStore;
    const host = service(
      async (_key, name) =>
        name === "__verify"
          ? verification()
          : name === "SearchRecordings"
            ? searchResponse()
            : payload({
                recordingDownload: {
                  assetUrl:
                    "https://audiocdn.epidemicsound.com/full.wav?signature=not-persisted",
                },
              }),
      media,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "3" },
      }),
    );
    await host.connect(key, new AbortController().signal);
    const importedTrack = await host.import(
      { kind: "music", id: sourceId, format: "WAV" },
      new AbortController().signal,
    );
    expect(Array.from(imported!)).toEqual([1, 2, 3]);
    expect(importedTrack.origin).toEqual({
      provider: "epidemic-sound",
      id: sourceId,
      kind: "music",
      artists: ["Example Artist"],
      stem: "FULL",
      format: "WAV",
    });
    expect(JSON.stringify(importedTrack)).not.toContain("signature");
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith("epidemic-download-"),
      ),
    ).toEqual([]);
    const project = { ...newProject(), tracks: [importedTrack] };
    expect(parseProject(project).tracks[0].origin).toEqual(
      importedTrack.origin,
    );
    expect(() =>
      parseProject({
        ...project,
        tracks: [
          {
            ...importedTrack,
            origin: { ...importedTrack.origin, id: "../../bad" },
          },
        ],
      }),
    ).toThrow(/source ID/);
  });
  it("rejects redirects outside Epidemic hosts and never sends an API key to media servers", async () => {
    const host = service(async (_key, name) =>
      name === "__verify"
        ? verification()
        : name === "SearchRecordings"
          ? searchResponse()
          : payload({
              recordingDownload: {
                assetUrl: "https://audiocdn.epidemicsound.com/full.wav",
              },
            }),
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.invalid/steal" },
      }),
    );
    await host.connect(key, new AbortController().signal);
    await expect(
      host.import(
        { kind: "music", id: sourceId },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/unsupported media/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith("epidemic-download-"),
      ),
    ).toEqual([]);
  });
});

describe("isolated preview cache", () => {
  it("plays measured MP3 assets without authorizing them for projects and evicts only preview files", async () => {
    const media = new MediaStore(directory);
    await media.initialize();
    const file = path.join(directory, "demonstration.mp3");
    await runProcess(await findBinary("ffmpeg"), [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.2",
      "-c:a",
      "libmp3lame",
      file,
    ]);
    const bytes = await readFile(file);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(bytes, {
          headers: { "content-length": String(bytes.length) },
        }),
    );
    const host = service(async (_key, name, args) => {
      if (name === "__verify") return verification();
      const id = (args.filter as { recordingIDs: string[] }).recordingIDs[0];
      return payload({
        recordings: { nodes: [{ recording: { ...recording(), id } }] },
      });
    }, media);
    await host.connect(key, new AbortController().signal);
    let firstFile: string | undefined;
    let last: AudioTrack | undefined;
    for (let index = 0; index < 7; index++) {
      const id = `123e4567-e89b-12d3-a456-${String(index).padStart(12, "0")}`;
      last = await host.preview(
        { kind: "music", id },
        new AbortController().signal,
      );
      if (index === 0) firstFile = host.previewFile(last.id);
      expect(media.has(last.id)).toBe(false);
      expect(last.peaks).toEqual([]);
      expect(last.duration).toBeGreaterThan(0);
    }
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(await stat(firstFile!).catch(() => null)).toBeNull();
    expect(
      (await readdir(path.join(directory, "epidemic-previews"))).length,
    ).toBe(6);
    expect(await readFile(file)).toEqual(bytes);
    expect(host.previewFile(last!.id)).toBeTruthy();
    await host.flush();
    expect(host.previewFile(last!.id)).toBeUndefined();
    expect(
      await stat(path.join(directory, "epidemic-previews")).catch(() => null),
    ).toBeNull();
    expect(await readFile(file)).toEqual(bytes);
  });
});

describe("bounded MCP transport", () => {
  it("rejects oversized declared and streaming replies without adopting any data", async () => {
    expect(() =>
      boundedEpidemicResponse(
        new Response("x", {
          headers: { "content-length": String(9 * 1024 ** 2) },
        }),
      ),
    ).toThrow(/oversized/);
    const response = boundedEpidemicResponse(
      new Response(new Uint8Array(8 * 1024 ** 2 + 1)),
    );
    await expect(response.arrayBuffer()).rejects.toThrow(/oversized/);
  });
});

describe("credential commit cancellation and disconnect races", () => {
  function heldCommit() {
    let hold = false;
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const io = {
      rename: async (
        from: Parameters<typeof rename>[0],
        to: Parameters<typeof rename>[1],
      ) => {
        await rename(from, to);
        if (hold) {
          entered();
          await gate;
        }
      },
      chmod,
    };
    return {
      io,
      waiting,
      release: () => release(),
      start: () => {
        hold = true;
      },
    };
  }
  it("rolls back a first connection cancelled after its encrypted file was renamed", async () => {
    const commit = heldCommit();
    commit.start();
    const host = new EpidemicService(
      directory,
      {} as MediaStore,
      cipher,
      async () => verification(),
      commit.io,
    );
    const controller = new AbortController();
    const pending = host.connect(key, controller.signal);
    const rejected = expect(pending).rejects.toThrow(/Cancelled/);
    await commit.waiting;
    expect(
      await stat(path.join(directory, "epidemic-credentials.json")),
    ).toBeTruthy();
    controller.abort();
    commit.release();
    await rejected;
    await host.flush();
    expect(host.status().connected).toBe(false);
    expect(
      await stat(path.join(directory, "epidemic-credentials.json")).catch(
        () => null,
      ),
    ).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
  it("restores the exact last working encrypted key when a replacement is cancelled after rename", async () => {
    const commit = heldCommit();
    let usedKey: string | undefined;
    const host = new EpidemicService(
      directory,
      {} as MediaStore,
      cipher,
      async (supplied, name) => {
        if (name === "__verify") return verification();
        usedKey = supplied;
        return searchResponse();
      },
      commit.io,
    );
    const initial = await host.connect(key, new AbortController().signal);
    const filename = path.join(directory, "epidemic-credentials.json"),
      before = await readFile(filename);
    commit.start();
    const controller = new AbortController();
    const pending = host.connect(otherKey, controller.signal);
    const rejected = expect(pending).rejects.toThrow(/Cancelled/);
    await commit.waiting;
    controller.abort();
    commit.release();
    await rejected;
    await host.flush();
    expect(await readFile(filename)).toEqual(before);
    expect(host.status()).toEqual(initial);
    await host.search({ kind: "music" }, new AbortController().signal);
    expect(usedKey).toBe(key);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(
      (await readdir(directory)).filter(
        (file) => file.endsWith(".tmp") || file.endsWith(".rollback"),
      ),
    ).toEqual([]);
  });
  it("disconnect wins over a connection held inside its file commit and cannot resurrect memory or disk credentials", async () => {
    const commit = heldCommit();
    const host = new EpidemicService(
      directory,
      {} as MediaStore,
      cipher,
      async () => verification(),
      commit.io,
    );
    await host.connect(key, new AbortController().signal);
    commit.start();
    const pending = host.connect(otherKey, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow(/newer connection/);
    await commit.waiting;
    const disconnected = host.disconnect();
    expect(host.status().connected).toBe(false);
    commit.release();
    await rejected;
    await disconnected;
    await host.flush();
    expect(host.status().connected).toBe(false);
    expect(
      await stat(path.join(directory, "epidemic-credentials.json")).catch(
        () => null,
      ),
    ).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
  it("reports verified-key local storage failures without leaking raw errors or replacing the working key", async () => {
    let fail = false;
    const host = new EpidemicService(
      directory,
      {} as MediaStore,
      cipher,
      async () => verification(),
      {
        rename: async (from, to) => {
          if (fail)
            throw Object.assign(new Error(`disk full ${otherKey}`), {
              code: "ENOSPC",
            });
          await rename(from, to);
        },
        chmod,
      },
    );
    const initial = await host.connect(key, new AbortController().signal);
    const filename = path.join(directory, "epidemic-credentials.json"),
      before = await readFile(filename);
    fail = true;
    try {
      await host.run("storage-failure", (signal) =>
        host.connect(otherKey, signal),
      );
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(EpidemicError);
      expect((error as EpidemicError).code).toBe("CREDENTIAL_STORAGE");
      expect((error as Error).message).toMatch(/verified.*saved securely/);
      expect((error as Error).message).not.toContain(otherKey);
      expect((error as Error).message).not.toContain("Could not reach");
    }
    await host.flush();
    expect(host.status()).toEqual(initial);
    expect(await readFile(filename)).toEqual(before);
  });
});
