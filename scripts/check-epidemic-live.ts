/** Opt-in integration check. Credentials are read in memory and never printed or saved. */
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EpidemicService } from "../electron/epidemic";
import { MediaStore, runProcess, findBinary } from "../electron/media";

const configuration = await readFile(
  path.join(os.homedir(), ".codex/config.toml"),
  "utf8",
);
const section =
  /^\[mcp_servers\.epidemic-sound\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(
    configuration,
  )?.[1];
const header =
  section && /Authorization\s*=\s*"Bearer ([^"\r\n]+)"/i.exec(section)?.[1];
if (!header)
  throw new Error(
    "The local Epidemic Sound MCP test connection is not configured.",
  );
const directory = await mkdtemp(
  path.join(os.tmpdir(), "mixstudio-epidemic-live-"),
);
try {
  const media = new MediaStore(directory);
  await media.initialize();
  const service = new EpidemicService(directory, media, {
    available: () => false,
    encrypt: () => {
      throw new Error("Session-only test");
    },
    decrypt: () => {
      throw new Error("Session-only test");
    },
  });
  const signal = new AbortController().signal;
  const connected = await service.connect(header, signal);
  const music = await service.search(
    { kind: "music", first: 3, genres: ["cinematic"], durationMax: 30 },
    signal,
  );
  const effects = await service.search(
    { kind: "soundtrack", first: 2, term: "soft whoosh", durationMax: 5 },
    signal,
  );
  if (!music.items.length || !effects.items.length)
    throw new Error("Real catalog searches returned no matching audio.");
  const preview = await service.preview(
    { kind: "soundtrack", id: effects.items[0].id },
    signal,
  );
  const decoded = await runProcess(
    await findBinary("ffmpeg"),
    [
      "-v",
      "error",
      "-i",
      service.previewFile(preview.id)!,
      "-t",
      "1",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-",
    ],
    { maxBytes: 48000 * 8 + 8192 },
  );
  const bytes = decoded.stdout;
  if (!bytes.byteLength) throw new Error("Preview audio contained no samples.");
  const downloaded = await service.import(
    { kind: "soundtrack", id: effects.items[0].id, format: "WAV" },
    signal,
  );
  if (downloaded.origin?.provider !== "epidemic-sound")
    throw new Error("Downloaded audio lost its source metadata.");
  const downloadedMusic = await service.import(
    { kind: "music", id: music.items[0].id, format: "MP3" },
    signal,
  );
  const second = music.endCursor
    ? await service.search(
        {
          kind: "music",
          first: 3,
          genres: ["cinematic"],
          durationMax: 30,
          after: music.endCursor,
        },
        signal,
      )
    : null;
  const similar = await service.search(
    { kind: "music", similarToId: music.items[0].id, first: 2 },
    signal,
  );
  console.log(
    JSON.stringify(
      {
        verified: connected.connected,
        musicResults: music.items.length,
        effectResults: effects.items.length,
        pagination: second?.items.length ?? 0,
        similarResults: similar.items.length,
        previewFrames: bytes.byteLength / 8,
        downloadDuration: downloaded.duration,
        downloadedMusicDuration: downloadedMusic.duration,
        downloadOrigin: downloaded.origin.provider,
        format: downloaded.origin.format,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
