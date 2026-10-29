import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import type { AudioTrack, OperationProgress } from "../src/shared/types";
import type {
  EpidemicAssetRequest,
  EpidemicConnection,
  EpidemicKind,
  EpidemicResult,
  EpidemicSearchPage,
  EpidemicSearchRequest,
  EpidemicStem,
} from "../src/shared/epidemic";
import { mediaUrl, findBinary, runProcess, type MediaStore } from "./media";

export const EPIDEMIC_ENDPOINT =
  "https://www.epidemicsound.com/a/mcp-service/mcp";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STEMS: EpidemicStem[] = ["FULL", "BASS", "DRUMS", "INSTRUMENTS"];
const SORTS = ["RELEVANCE", "POPULARITY", "DATE", "DURATION", "TITLE", "BPM"];
const REQUIRED_TOOLS = [
  "SearchRecordings",
  "SearchSoundEffects",
  "DownloadRecording",
  "DownloadSoundEffect",
];
const MAX_DOWNLOAD = 512 * 1024 ** 2;

export class EpidemicError extends Error {
  constructor(
    message: string,
    readonly code = "EPIDEMIC_ERROR",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "EpidemicError";
  }
}
function record(value: unknown, label = "response"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EpidemicError(`Epidemic Sound returned an invalid ${label}.`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  label: string,
  max = 1000,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  )
    throw new EpidemicError(`Invalid ${label}.`);
  return value;
}
function identifier(value: unknown): string {
  const id = text(value, "Epidemic Sound audio ID", 36);
  if (!UUID.test(id))
    throw new EpidemicError("Invalid Epidemic Sound audio ID.");
  return id;
}
function optionalText(
  value: unknown,
  label: string,
  max = 1000,
): string | undefined {
  return value === undefined ? undefined : text(value, label, max).trim();
}
function finite(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new EpidemicError(`Invalid ${label}.`);
  return value;
}
function slugs(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (v) => typeof v !== "string" || !/^[a-z0-9][a-z0-9_-]{0,199}$/u.test(v),
    )
  )
    throw new EpidemicError(`Invalid ${label}.`);
  return [...new Set(value as string[])];
}
export function checkedEpidemicSearch(value: unknown): EpidemicSearchRequest {
  const input = record(value, "search request");
  const allowed = [
    "kind",
    "term",
    "topic",
    "after",
    "first",
    "sort",
    "order",
    "genres",
    "moods",
    "instruments",
    "musicalKeys",
    "decades",
    "countries",
    "tags",
    "artistSlugs",
    "vocals",
    "bpmMin",
    "bpmMax",
    "durationMin",
    "durationMax",
    "similarToId",
    "reference",
    "taxonomyMatch",
    "moodMatch",
    "instrumentMatch",
    "tagMatch",
    "artistMatch",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new EpidemicError("The search contains an unsupported option.");
  if (input.kind !== "music" && input.kind !== "soundtrack")
    throw new EpidemicError("Choose music or sound effects.");
  const request: EpidemicSearchRequest = { kind: input.kind };
  for (const field of ["term", "topic", "after", "reference"] as const) {
    const v = optionalText(
      input[field],
      `Epidemic Sound ${field}`,
      field === "after" ? 4096 : 1000,
    );
    if (v) request[field] = v;
  }
  if (
    [request.term, request.topic, request.reference, input.similarToId].filter(
      Boolean,
    ).length > 1
  )
    throw new EpidemicError("Choose a single search mode.");
  if (input.similarToId !== undefined)
    request.similarToId = identifier(input.similarToId);
  for (const key of [
    "taxonomyMatch",
    "moodMatch",
    "instrumentMatch",
    "tagMatch",
    "artistMatch",
  ] as const) {
    if (input[key] !== undefined) {
      if (!["ALL", "ANY", "NOT_ANY"].includes(input[key] as string))
        throw new EpidemicError("Invalid filter matching mode.");
      request[key] = input[key] as "ALL" | "ANY" | "NOT_ANY";
    }
  }
  if (input.first !== undefined) {
    request.first = finite(input.first, "page size", 1, 50);
    if (!Number.isInteger(request.first))
      throw new EpidemicError("Invalid page size.");
  }
  if (input.sort !== undefined) {
    if (
      !SORTS.includes(input.sort as string) ||
      (input.kind === "soundtrack" && input.sort === "BPM")
    )
      throw new EpidemicError("Invalid search sort.");
    request.sort = input.sort as EpidemicSearchRequest["sort"];
  }
  if (input.order !== undefined) {
    if (input.order !== "ASCENDING" && input.order !== "DESCENDING")
      throw new EpidemicError("Invalid search order.");
    request.order = input.order;
  }
  for (const field of [
    "genres",
    "moods",
    "instruments",
    "musicalKeys",
    "decades",
    "countries",
    "tags",
    "artistSlugs",
  ] as const) {
    const v = slugs(input[field], field);
    if (v?.length) request[field] = v;
  }
  if (input.vocals !== undefined) {
    if (!["any", "instrumental", "vocals"].includes(input.vocals as string))
      throw new EpidemicError("Invalid vocal filter.");
    request.vocals = input.vocals as EpidemicSearchRequest["vocals"];
  }
  for (const field of [
    "bpmMin",
    "bpmMax",
    "durationMin",
    "durationMax",
  ] as const)
    if (input[field] !== undefined)
      request[field] = finite(
        input[field],
        field,
        0,
        field.startsWith("bpm") ? 1000 : 43200,
      );
  if (
    (request.bpmMin ?? 0) > (request.bpmMax ?? Infinity) ||
    (request.durationMin ?? 0) > (request.durationMax ?? Infinity)
  )
    throw new EpidemicError(
      "A filter minimum cannot be greater than its maximum.",
    );
  if (
    request.kind === "soundtrack" &&
    (request.topic ||
      request.reference ||
      request.genres?.length ||
      request.moods?.length ||
      request.instruments?.length ||
      request.musicalKeys?.length ||
      request.decades?.length ||
      request.countries?.length ||
      request.artistSlugs?.length ||
      request.bpmMin !== undefined ||
      request.bpmMax !== undefined ||
      (request.vocals && request.vocals !== "any"))
  )
    throw new EpidemicError("That filter is available for music only.");
  if (
    request.similarToId &&
    Object.entries(request).some(
      ([key, value]) =>
        !["kind", "similarToId", "after", "first"].includes(key) &&
        value !== undefined &&
        value !== "any" &&
        (!Array.isArray(value) || value.length),
    )
  )
    throw new EpidemicError(
      "Similar audio uses its own ranking. Clear other filters and sorting first.",
    );
  return request;
}
export function checkedEpidemicAsset(value: unknown): EpidemicAssetRequest {
  const input = record(value, "audio request");
  if (
    Object.keys(input).some(
      (key) => !["id", "kind", "stem", "format"].includes(key),
    )
  )
    throw new EpidemicError("Invalid Epidemic Sound audio request.");
  if (input.kind !== "music" && input.kind !== "soundtrack")
    throw new EpidemicError("Choose music or sound effects.");
  if (
    (input.stem !== undefined && !STEMS.includes(input.stem as EpidemicStem)) ||
    (input.kind === "soundtrack" && input.stem && input.stem !== "FULL")
  )
    throw new EpidemicError("Choose an available audio stem.");
  if (
    input.format !== undefined &&
    input.format !== "WAV" &&
    input.format !== "MP3"
  )
    throw new EpidemicError("Choose WAV or MP3.");
  return {
    id: identifier(input.id),
    kind: input.kind,
    stem: (input.stem as EpidemicStem | undefined) ?? "FULL",
    format: (input.format as "WAV" | "MP3" | undefined) ?? "WAV",
  };
}

export function checkedEpidemicURL(value: unknown, artwork = false): URL {
  const url = new URL(text(value, "Epidemic Sound media URL", 16384));
  const allowed = artwork
    ? ["cdn.epidemicsound.com"]
    : [
        "audiocdn.epidemicsound.com",
        "cdn.epidemicsound.com",
        "download.epidemicsound.com",
        "downloads.epidemicsound.com",
      ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !allowed.includes(url.hostname)
  )
    throw new EpidemicError(
      "Epidemic Sound returned an unsupported media address.",
    );
  return url;
}
function safeError(error: unknown): EpidemicError {
  if (error instanceof EpidemicError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/abort|cancel/i.test(message))
    return new EpidemicError(
      "Cancelled. Your project is unchanged.",
      "CANCELLED",
    );
  if (/401|unauthori[sz]ed|invalid.*token/i.test(message))
    return new EpidemicError(
      "This key was not accepted. Use an MCP Server API key from Epidemic Sound Account → API keys, rather than a Developer Portal key.",
      "UNAUTHORIZED",
    );
  if (/403|forbidden/i.test(message))
    return new EpidemicError(
      "Your Epidemic Sound account does not allow this action. Check your subscription and key permissions.",
      "FORBIDDEN",
    );
  if (/timeout|timed out/i.test(message))
    return new EpidemicError(
      "Epidemic Sound took too long to respond. Try again.",
      "TIMEOUT",
    );
  return new EpidemicError(
    "Could not reach Epidemic Sound. Check your connection and try again.",
    "NETWORK",
  );
}
function retrySeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.ceil(value))
    : undefined;
}
function toolError(errors: unknown): never {
  const error =
    Array.isArray(errors) && errors.length ? record(errors[0], "error") : {};
  const extension =
    error.extensions && typeof error.extensions === "object"
      ? (error.extensions as Record<string, unknown>)
      : {};
  const code = String(extension.code ?? error.code ?? "");
  if (
    code === "RETRY_LATER" ||
    code === "RATE_LIMITED" ||
    code === "TOO_MANY_REQUESTS"
  ) {
    const delay = retrySeconds(extension.retryAfterSeconds) ?? 10;
    throw new EpidemicError(
      `Epidemic Sound is preparing this audio or limiting requests. Wait ${delay} seconds before trying again.`,
      "RETRY_LATER",
      delay,
    );
  }
  if (/UNAUTH|TOKEN|CREDENTIAL/.test(code))
    throw new EpidemicError(
      "This key is no longer accepted. Reconnect Epidemic Sound in Studio settings.",
      "UNAUTHORIZED",
    );
  if (/FORBIDDEN|PERMISSION|SUBSCRIPTION/.test(code))
    throw new EpidemicError(
      "Your Epidemic Sound subscription does not allow this action.",
      "FORBIDDEN",
    );
  throw new EpidemicError(
    "Epidemic Sound could not complete this request. Try again or check your account.",
    "REMOTE_ERROR",
  );
}
export function epidemicToolData(value: unknown): Record<string, unknown> {
  const result = record(value);
  let payload: unknown = result.structuredContent;
  if (!payload) {
    const blocks = result.content;
    if (!Array.isArray(blocks))
      throw new EpidemicError("Epidemic Sound returned no catalog data.");
    const block = blocks.find(
      (block) =>
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text",
    ) as Record<string, unknown> | undefined;
    if (typeof block?.text !== "string" || block.text.length > 8 * 1024 ** 2)
      throw new EpidemicError("Epidemic Sound returned invalid catalog data.");
    try {
      payload = JSON.parse(block.text);
    } catch {
      if (result.isError) toolError([]);
      throw new EpidemicError("Epidemic Sound returned invalid JSON.");
    }
  }
  const data = record(payload);
  if ((Array.isArray(data.errors) && data.errors.length) || result.isError)
    toolError(data.errors);
  const inner = data.data ? record(data.data) : data;
  if (Array.isArray(inner.errors) && inner.errors.length)
    toolError(inner.errors);
  return inner;
}

export type EpidemicCall = (
  key: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
export function boundedEpidemicResponse(response: Response): Response {
  const limit = 8 * 1024 ** 2;
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel();
    throw new EpidemicError("Epidemic Sound returned an oversized response.");
  }
  if (!response.body) return response;
  let received = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > limit) {
          controller.error(
            new EpidemicError("Epidemic Sound returned an oversized response."),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
function headerRetrySeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return retrySeconds(
    Number.isFinite(numeric)
      ? numeric
      : Number.isFinite(Date.parse(value))
        ? (Date.parse(value) - Date.now()) / 1000
        : undefined,
  );
}
export const callEpidemic: EpidemicCall = async (key, name, args, signal) => {
  const timeout = AbortSignal.timeout(60_000);
  const combined = AbortSignal.any([signal, timeout]);
  const client = new Client(
    { name: "Audio Mix Studio", version: "0.7.0" },
    { capabilities: {} },
  );
  client.onerror = () => undefined;
  const transport = new StreamableHTTPClientTransport(
    new URL(EPIDEMIC_ENDPOINT),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
      },
      fetch: async (input, init) => {
        const requested = new URL(input);
        if (requested.href !== EPIDEMIC_ENDPOINT)
          throw new EpidemicError(
            "Blocked an unexpected Epidemic Sound service address.",
          );
        const response = await fetch(input, {
          ...init,
          signal: AbortSignal.any([
            combined,
            ...(init?.signal ? [init.signal] : []),
          ]),
          redirect: "error",
        });
        if (response.status === 429) {
          const delay =
            headerRetrySeconds(response.headers.get("retry-after")) ?? 10;
          await response.body?.cancel();
          throw new EpidemicError(
            `Epidemic Sound is limiting requests. Wait ${delay} seconds before trying again.`,
            "RETRY_LATER",
            delay,
          );
        }
        return boundedEpidemicResponse(response);
      },
    },
  );
  try {
    await client.connect(transport, { signal: combined, timeout: 60_000 });
    if (name === "__verify") {
      const listed = await client.listTools(
        {},
        { signal: combined, timeout: 30_000 },
      );
      if (
        REQUIRED_TOOLS.some(
          (name) => !listed.tools.some((tool) => tool.name === name),
        )
      )
        throw new EpidemicError(
          "This key does not expose the Epidemic Sound music and sound-effect tools.",
        );
      return await client.callTool(
        {
          name: "SearchRecordings",
          arguments: {
            first: 1,
            sort: { by: "POPULARITY", order: "DESCENDING" },
          },
        },
        { signal: combined, timeout: 30_000 },
      );
    }
    return await client.callTool(
      { name, arguments: args },
      { signal: combined, timeout: 45_000 },
    );
  } catch (error) {
    if (signal.aborted)
      throw new EpidemicError(
        "Cancelled. Your project is unchanged.",
        "CANCELLED",
      );
    if (timeout.aborted)
      throw new EpidemicError(
        "Epidemic Sound took too long to respond. Try again.",
        "TIMEOUT",
      );
    throw safeError(error);
  } finally {
    await client.close().catch(() => undefined);
  }
};

interface StoredResult {
  item: EpidemicResult;
  preview: string;
  stems: Partial<Record<EpidemicStem, string>>;
}
function parsedRecording(raw: unknown, kind: EpidemicKind): StoredResult {
  const input = record(raw, "audio record"),
    audio = record(input.audioFile, "audio metadata");
  const tags = Array.isArray(input.tags)
    ? input.tags.slice(0, 100).map((raw) => {
        const tag = record(raw, "audio tag");
        return {
          label: text(tag.displayName, "audio tag", 200),
          dimension:
            kind === "music"
              ? text(
                  record(tag.dimension, "tag category").name,
                  "tag category",
                  100,
                )
              : "sound effect",
          ...(typeof tag.slug === "string"
            ? { slug: text(tag.slug, "audio category", 200) }
            : {}),
        };
      })
    : [];
  const artists =
    kind === "music" && Array.isArray(input.credits)
      ? [
          ...new Set(
            input.credits.flatMap((raw) => {
              const credit = record(raw, "credit");
              return credit.role === "MAIN_ARTIST" ||
                credit.role === "FEATURED_ARTIST"
                ? [text(record(credit.artist).name, "artist name", 300)]
                : [];
            }),
          ),
        ]
      : [];
  const stems: Partial<Record<EpidemicStem, string>> = {};
  if (kind === "music" && Array.isArray(input.stems))
    for (const raw of input.stems) {
      const stem = record(raw, "stem");
      if (STEMS.includes(stem.type as EpidemicStem))
        stems[stem.type as EpidemicStem] = checkedEpidemicURL(
          record(stem.audioFile).lqmp3Url,
        ).href;
    }
  const item: EpidemicResult = {
    id: identifier(input.id),
    kind,
    title: text(input.title, "audio title", 1000),
    artists,
    ...(kind === "music" && Array.isArray(input.credits)
      ? {
          artistFilters: input.credits.flatMap((raw) => {
            const credit = record(raw);
            if (
              credit.role !== "MAIN_ARTIST" &&
              credit.role !== "FEATURED_ARTIST"
            )
              return [];
            const artist = record(credit.artist);
            return [
              {
                label: text(artist.name, "artist name", 300),
                value: text(artist.slug, "artist filter", 200),
              },
            ];
          }),
        }
      : {}),
    duration:
      finite(audio.durationInMilliseconds, "audio duration", 1, 43_200_000) /
      1000,
    ...(kind === "music"
      ? { bpm: finite(input.bpm, "track tempo", 0, 1000) }
      : {}),
    ...(kind === "music" && input.coverArtUrl
      ? { coverArtUrl: checkedEpidemicURL(input.coverArtUrl, true).href }
      : {}),
    tags,
    stems: ["FULL", ...(Object.keys(stems) as EpidemicStem[])],
  };
  return { item, preview: checkedEpidemicURL(audio.lqmp3Url).href, stems };
}
function match(values: string[] | undefined, type = "ANY") {
  return values?.length ? { matchType: type, values } : undefined;
}
export function epidemicSearchArguments(
  request: EpidemicSearchRequest,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const range = (
    min: number | undefined,
    max: number | undefined,
    factor: number,
  ) =>
    min !== undefined || max !== undefined
      ? {
          ...(min !== undefined ? { min: Math.round(min * factor) } : {}),
          ...(max !== undefined ? { max: Math.round(max * factor) } : {}),
        }
      : undefined;
  const duration = range(request.durationMin, request.durationMax, 1000);
  if (duration) filter.duration = duration;
  if (request.tags?.length)
    filter.tagSlugs = match(request.tags, request.tagMatch ?? "ANY");
  if (request.kind === "music") {
    const taxonomy = [
      ...(request.genres ?? []),
      ...(request.decades ?? []),
      ...(request.countries ?? []),
    ];
    if (taxonomy.length)
      filter.taxonomySlugs = match(taxonomy, request.taxonomyMatch ?? "ALL");
    if (request.moods?.length)
      filter.moodSlugs = match(request.moods, request.moodMatch ?? "ANY");
    if (request.instruments?.length)
      filter.featuredInstrumentSlugs = match(
        request.instruments,
        request.instrumentMatch ?? "ANY",
      );
    if (request.artistSlugs?.length)
      filter.artistSlugs = match(
        request.artistSlugs,
        request.artistMatch ?? "ANY",
      );
    if (request.musicalKeys?.length) filter.musicalKeys = request.musicalKeys;
    if (request.vocals && request.vocals !== "any")
      filter.vocals = request.vocals === "vocals";
    const bpm = range(request.bpmMin, request.bpmMax, 1);
    if (bpm) filter.bpm = bpm;
  }
  return {
    first: request.first ?? 24,
    ...(request.after ? { after: request.after } : {}),
    ...(Object.keys(filter).length ? { filter } : {}),
    ...(request.term || request.topic
      ? {
          query: request.term
            ? { term: request.term }
            : { topic: request.topic },
        }
      : {}),
    sort: {
      by:
        request.sort ??
        (request.term || request.topic ? "RELEVANCE" : "POPULARITY"),
      order: request.order ?? "DESCENDING",
    },
  };
}
export interface EpidemicCipher {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export interface EpidemicCredentialIO {
  rename: typeof rename;
  chmod: typeof chmod;
}

export class EpidemicService {
  private key: string | undefined;
  private verifiedAt: string | undefined;
  private epoch = 0;
  private cooldown = 0;
  private credentialQueue: Promise<void> = Promise.resolve();
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly records = new Map<string, StoredResult>();
  private readonly previews = new Map<string, AudioTrack>();
  private readonly credentialFile: string;
  private readonly previewFiles = new Map<string, string>();
  private readonly previewDirectory: string;
  constructor(
    private readonly root: string,
    private readonly media: MediaStore,
    private readonly cipher: EpidemicCipher,
    private readonly call: EpidemicCall = callEpidemic,
    private readonly credentialIO: EpidemicCredentialIO = { rename, chmod },
  ) {
    this.credentialFile = path.join(root, "epidemic-credentials.json");
    this.previewDirectory = path.join(root, "epidemic-previews");
  }
  async initialize() {
    await rm(this.previewDirectory, { recursive: true, force: true });
    if (!this.cipher.available()) return;
    try {
      const bytes = await readFile(this.credentialFile);
      if (bytes.length > 32_768) return;
      const saved = record(JSON.parse(bytes.toString()));
      if (
        saved.version !== 1 ||
        typeof saved.encrypted !== "string" ||
        typeof saved.verifiedAt !== "string" ||
        !Number.isFinite(Date.parse(saved.verifiedAt))
      )
        return;
      this.key = this.checkedKey(
        this.cipher.decrypt(Buffer.from(saved.encrypted, "base64")),
      );
      this.verifiedAt = saved.verifiedAt;
    } catch {
      /* A missing or unreadable credential never breaks project recovery. */
    }
  }
  status(): EpidemicConnection {
    return {
      connected: Boolean(this.key),
      ...(this.key && this.verifiedAt ? { verifiedAt: this.verifiedAt } : {}),
      secureStorage: this.cipher.available(),
    };
  }
  private checkedKey(value: unknown): string {
    const key = text(value, "Epidemic Sound API key", 4096)
      .trim()
      .replace(/^Bearer\s+/i, "");
    if (key.length < 16 || /\s/u.test(key))
      throw new EpidemicError(
        "Enter your MCP Server API key from Epidemic Sound Account → API keys.",
      );
    return key;
  }
  run<T>(
    requestId: unknown,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const id = text(requestId, "request ID", 100);
    if (
      !/^[a-zA-Z0-9_-]+$/u.test(id) ||
      this.controllers.has(id) ||
      this.controllers.size >= 24
    )
      return Promise.reject(
        new EpidemicError(
          "That Epidemic Sound request cannot start. Try again.",
        ),
      );
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return action(controller.signal);
      })
      .catch((error) => {
        throw safeError(error);
      })
      .finally(() => {
        this.controllers.delete(id);
        this.tasks.delete(task);
      });
    this.tasks.add(task);
    return task;
  }
  cancel(requestId: unknown) {
    const id = text(requestId, "request ID", 100);
    this.controllers.get(id)?.abort();
  }
  shutdown() {
    for (const controller of this.controllers.values()) controller.abort();
  }
  async flush() {
    await Promise.allSettled([...this.tasks, this.credentialQueue]);
    await rm(this.previewDirectory, { recursive: true, force: true });
    this.previewFiles.clear();
    this.previews.clear();
  }
  previewFile(id: string): string | undefined {
    return this.previewFiles.get(id);
  }
  async connect(
    value: unknown,
    signal: AbortSignal,
  ): Promise<EpidemicConnection> {
    const key = this.checkedKey(value),
      epoch = ++this.epoch;
    const data = epidemicToolData(await this.call(key, "__verify", {}, signal));
    const catalog = record(data.recordings, "verified music catalog");
    if (!Array.isArray(catalog.nodes))
      throw new EpidemicError(
        "This key could not read the Epidemic Sound catalog.",
      );
    signal.throwIfAborted();
    if (epoch !== this.epoch)
      throw new EpidemicError(
        "A newer connection replaced this request.",
        "CANCELLED",
      );
    const verifiedAt = new Date().toISOString();
    const temporary = `${this.credentialFile}.${randomUUID()}.tmp`;
    const backup = `${this.credentialFile}.${randomUUID()}.rollback`;
    let preserveBackup = false;
    const assertCurrent = () => {
      if (signal.aborted)
        throw new EpidemicError(
          "Cancelled. Your previous connection is unchanged.",
          "CANCELLED",
        );
      if (epoch !== this.epoch)
        throw new EpidemicError(
          "A newer connection replaced this request.",
          "CANCELLED",
        );
    };
    const storageFailure = (recovery = false) =>
      new EpidemicError(
        "The key was verified, but could not be saved securely on this Mac. Check available disk space and your login Keychain, then retry." +
          (recovery
            ? " Previous encrypted credentials were preserved for recovery."
            : " Your previous connection is unchanged."),
        "CREDENTIAL_STORAGE",
      );
    const save = this.credentialQueue
      .catch(() => undefined)
      .then(async () => {
        assertCurrent();
        let hadPrevious = false;
        let replacementAttempted = false;
        try {
          if (this.cipher.available()) {
            await mkdir(this.root, { recursive: true });
            try {
              const prior = await lstat(this.credentialFile);
              if (
                !prior.isFile() ||
                prior.isSymbolicLink() ||
                prior.size > 32768
              )
                throw storageFailure();
              await copyFile(
                this.credentialFile,
                backup,
                constants.COPYFILE_EXCL,
              );
              await chmod(backup, 0o600);
              hadPrevious = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            const file = await open(temporary, "wx", 0o600);
            try {
              await file.writeFile(
                JSON.stringify({
                  version: 1,
                  encrypted: this.cipher.encrypt(key).toString("base64"),
                  verifiedAt,
                }),
              );
              await file.sync();
            } finally {
              await file.close();
            }
            assertCurrent();
            // The backup is ready before replacement and remains available until
            // the final post-I/O guard. No cancellation can resurrect a key.
            replacementAttempted = true;
            await this.credentialIO.rename(temporary, this.credentialFile);
            await this.credentialIO.chmod(this.credentialFile, 0o600);
          }
          await rm(this.previewDirectory, {
            recursive: true,
            force: true,
          }).catch(() => undefined);
          assertCurrent();
          // This synchronous block is the credential transaction's commit point.
          // There are no awaits between the guard and the in-memory adoption.
          this.key = key;
          this.verifiedAt = verifiedAt;
          this.records.clear();
          this.previews.clear();
          this.previewFiles.clear();
          this.cooldown = 0;
        } catch (error) {
          if (replacementAttempted) {
            try {
              if (hadPrevious) await rename(backup, this.credentialFile);
              else await rm(this.credentialFile, { force: true });
            } catch {
              preserveBackup = hadPrevious;
              throw storageFailure(preserveBackup);
            }
          }
          if (error instanceof EpidemicError && error.code === "CANCELLED")
            throw error;
          if (signal.aborted || epoch !== this.epoch) {
            assertCurrent();
          }
          throw storageFailure();
        }
      });
    // Cleanup is serialized but is not part of the user-visible commit. A late
    // cancel after a completed commit does not turn success into a partial save.
    const cleanup = async () => {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (!preserveBackup)
        await rm(backup, { force: true }).catch(() => undefined);
    };
    this.credentialQueue = save.then(cleanup, cleanup).catch(() => undefined);
    await save;
    return this.status();
  }
  async disconnect() {
    this.epoch++;
    this.shutdown();
    const clear = () => {
      this.key = undefined;
      this.verifiedAt = undefined;
      this.records.clear();
      this.previews.clear();
      this.previewFiles.clear();
    };
    clear();
    const save = this.credentialQueue
      .catch(() => undefined)
      .then(async () => {
        await rm(this.credentialFile, { force: true });
        await rm(this.previewDirectory, { recursive: true, force: true });
        // A pending connect cannot resurrect the session even if its file I/O
        // completed while this removal was queued.
        clear();
      });
    this.credentialQueue = save;
    await save;
  }

  private async invoke(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const key = this.key;
    if (!key)
      throw new EpidemicError(
        "Connect Epidemic Sound with your MCP Server API key first.",
        "NOT_CONNECTED",
      );
    if (Date.now() < this.cooldown) {
      const wait = Math.ceil((this.cooldown - Date.now()) / 1000);
      throw new EpidemicError(
        `Wait ${wait} seconds before trying Epidemic Sound again.`,
        "RETRY_LATER",
        wait,
      );
    }
    try {
      const result = epidemicToolData(await this.call(key, name, args, signal));
      signal.throwIfAborted();
      if (this.key !== key)
        throw new EpidemicError(
          "The Epidemic Sound connection changed.",
          "CANCELLED",
        );
      return result;
    } catch (error) {
      const safe = safeError(error);
      if (safe.retryAfterSeconds)
        this.cooldown = Date.now() + safe.retryAfterSeconds * 1000;
      throw safe;
    }
  }
  private remember(raw: unknown, kind: EpidemicKind): EpidemicResult {
    const result = parsedRecording(raw, kind);
    this.records.set(`${kind}:${result.item.id}`, result);
    while (this.records.size > 2000)
      this.records.delete(this.records.keys().next().value!);
    return result.item;
  }
  async search(
    value: unknown,
    signal: AbortSignal,
  ): Promise<EpidemicSearchPage> {
    const request = checkedEpidemicSearch(value);
    let data: Record<string, unknown>, connection: Record<string, unknown>;
    if (request.similarToId) {
      data = await this.invoke(
        request.kind === "music"
          ? "SearchSimilarToRecording"
          : "SearchSimilarToSoundEffect",
        {
          id: request.similarToId,
          first: request.first ?? 24,
          ...(request.after ? { after: request.after } : {}),
        },
        signal,
      );
      connection = record(
        record(
          data[request.kind === "music" ? "recording" : "soundEffect"],
          "similar audio",
        )[
          request.kind === "music" ? "similarRecordings" : "similarSoundEffects"
        ],
        "similar catalog",
      );
    } else {
      const args = epidemicSearchArguments(request);
      if (request.reference) {
        const ref = await this.invoke(
          "SearchExternalReferences",
          { term: request.reference, first: 1 },
          signal,
        );
        const found = record(
          ref.recordingsExternalReferences ?? ref.recordingExternalReferences,
          "reference search",
        );
        const first = Array.isArray(found.nodes) ? found.nodes[0] : undefined;
        if (!first)
          return { items: [], total: 0, hasNextPage: false, endCursor: null };
        const reference = record(first);
        if (reference.type !== "SPOTIFY_TRACK")
          throw new EpidemicError("That reference is not supported.");
        args.query = {
          externalID: {
            type: "SPOTIFY_TRACK",
            id: text(reference.id, "reference ID", 300),
          },
        };
      }
      data = await this.invoke(
        request.kind === "music" ? "SearchRecordings" : "SearchSoundEffects",
        args,
        signal,
      );
      connection = record(
        data[request.kind === "music" ? "recordings" : "soundEffects"],
        "search catalog",
      );
    }
    if (!Array.isArray(connection.nodes) || connection.nodes.length > 100)
      throw new EpidemicError(
        "Epidemic Sound returned invalid search results.",
      );
    const items = connection.nodes.map((raw) => {
      const wrapper = record(raw);
      return this.remember(
        request.similarToId
          ? raw
          : wrapper[request.kind === "music" ? "recording" : "soundEffect"],
        request.kind,
      );
    });
    const page = record(connection.pageInfo, "page information");
    if (
      typeof page.hasNextPage !== "boolean" ||
      (page.endCursor !== null &&
        page.endCursor !== undefined &&
        typeof page.endCursor !== "string")
    )
      throw new EpidemicError("Epidemic Sound returned invalid pagination.");
    const meta =
      connection.meta && typeof connection.meta === "object"
        ? (connection.meta as Record<string, unknown>)
        : {};
    return {
      items,
      total:
        typeof meta.total === "number"
          ? finite(meta.total, "result count", 0, Number.MAX_SAFE_INTEGER)
          : null,
      hasNextPage: page.hasNextPage,
      endCursor: page.endCursor
        ? text(page.endCursor, "page cursor", 4096)
        : null,
    };
  }
  private async source(
    request: EpidemicAssetRequest,
    signal: AbortSignal,
  ): Promise<StoredResult> {
    const id = `${request.kind}:${request.id}`;
    if (!this.key)
      throw new EpidemicError("Connect Epidemic Sound first.", "NOT_CONNECTED");
    const existing = this.records.get(id);
    if (existing) return existing;
    const data = await this.invoke(
      request.kind === "music" ? "SearchRecordings" : "SearchSoundEffects",
      {
        first: 1,
        filter: {
          [request.kind === "music" ? "recordingIDs" : "soundEffectIDs"]: [
            request.id,
          ],
        },
      },
      signal,
    );
    const connection = record(
      data[request.kind === "music" ? "recordings" : "soundEffects"],
    );
    const raw =
      Array.isArray(connection.nodes) && connection.nodes[0]
        ? record(connection.nodes[0])[
            request.kind === "music" ? "recording" : "soundEffect"
          ]
        : undefined;
    if (!raw)
      throw new EpidemicError(
        "This audio is no longer available from Epidemic Sound.",
      );
    this.remember(raw, request.kind);
    return this.records.get(id)!;
  }
  private async localAudio(
    urlValue: unknown,
    name: string,
    format: "WAV" | "MP3",
    signal: AbortSignal,
    report?: (p: OperationProgress) => void,
    previewOnly = false,
  ): Promise<AudioTrack> {
    const directory = await mkdtemp(path.join(this.root, "epidemic-download-"));
    const destination = path.join(directory, `audio.${format.toLowerCase()}`);
    try {
      let url = checkedEpidemicURL(urlValue),
        response: Response | undefined;
      for (let redirects = 0; redirects <= 4; redirects++) {
        signal.throwIfAborted();
        response = await fetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
          redirect: "manual",
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 4)
          throw new EpidemicError(
            "Epidemic Sound returned too many download redirects.",
          );
        url = checkedEpidemicURL(new URL(location, url).href);
      }
      if (response?.status === 429) {
        const delay =
          headerRetrySeconds(response.headers.get("retry-after")) ?? 10;
        this.cooldown = Date.now() + delay * 1000;
        await response.body?.cancel();
        throw new EpidemicError(
          `Epidemic Sound is limiting downloads. Wait ${delay} seconds before trying again.`,
          "RETRY_LATER",
          delay,
        );
      }
      if (!response?.ok || !response.body) {
        await response?.body?.cancel();
        throw new EpidemicError(
          response?.status === 403
            ? "The audio link expired or your plan does not allow downloads. Select the audio again to refresh it."
            : "Could not download this audio from Epidemic Sound.",
        );
      }
      const size = Number(response.headers.get("content-length") ?? 0);
      if (!Number.isFinite(size) || size < 0 || size > MAX_DOWNLOAD) {
        await response.body.cancel();
        throw new EpidemicError(
          "This audio exceeds the 512 MB download limit.",
        );
      }
      const file = await open(destination, "wx", 0o600);
      let received = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          received += chunk.byteLength;
          if (received > MAX_DOWNLOAD)
            throw new EpidemicError(
              "This audio exceeds the 512 MB download limit.",
            );
          await file.writeFile(chunk);
          report?.({
            phase: "downloading",
            message: `Downloading ${name}…`,
            ...(size ? { fraction: Math.min(1, received / size) } : {}),
          });
        }
      } finally {
        await file.close();
      }
      if (!received || (size && received !== size))
        throw new EpidemicError(
          "The audio download was incomplete. Try again.",
        );
      signal.throwIfAborted();
      report?.({ phase: "importing", message: `Preparing ${name}…` });
      if (previewOnly) {
        // Audition assets stay in an isolated bounded MP3 cache. Their opaque
        // IDs are playable but can never authorize a project/export source.
        const probe = await runProcess(
          await findBinary("ffprobe"),
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            destination,
          ],
          { signal, timeoutMs: 30_000, maxBytes: 1024 },
        );
        const duration = Number(probe.stdout.toString().trim());
        if (!Number.isFinite(duration) || duration <= 0 || duration > 43200)
          throw new EpidemicError(
            "Epidemic Sound returned an invalid audio preview.",
          );
        await mkdir(this.previewDirectory, { recursive: true });
        const id = randomUUID(),
          filename = path.join(this.previewDirectory, `${id}.mp3`);
        signal.throwIfAborted();
        await rename(destination, filename);
        if (signal.aborted) {
          await rm(filename, { force: true });
          signal.throwIfAborted();
        }
        this.previewFiles.set(id, filename);
        return {
          id,
          name,
          duration,
          peaks: [],
          color: "#6598b9",
          mediaUrl: mediaUrl(id),
        };
      }
      return await this.media.importAudio(destination, {
        name,
        signal,
        onProgress: report,
      });
    } catch (error) {
      if (signal.aborted)
        throw new EpidemicError(
          "Cancelled. Your project is unchanged.",
          "CANCELLED",
        );
      if (error instanceof EpidemicError) throw error;
      throw new EpidemicError(
        "The audio could not be prepared. Check FFmpeg and your connection, then try again.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async preview(value: unknown, signal: AbortSignal): Promise<AudioTrack> {
    const request = checkedEpidemicAsset(value),
      source = await this.source(request, signal),
      key = `${request.kind}:${request.id}:${request.stem}`;
    if (!source.item.stems.includes(request.stem!))
      throw new EpidemicError("This stem is not available for that audio.");
    const cached = this.previews.get(key);
    if (cached) {
      const filename = this.previewFiles.get(cached.id);
      if (
        filename &&
        (await stat(filename)
          .then((value) => value.isFile())
          .catch(() => false))
      ) {
        this.previews.delete(key);
        this.previews.set(key, cached);
        return cached;
      }
      this.previews.delete(key);
      this.previewFiles.delete(cached.id);
    }
    const audio = await this.localAudio(
      request.stem === "FULL" ? source.preview : source.stems[request.stem!],
      `${source.item.title} · Preview`,
      "MP3",
      signal,
      undefined,
      true,
    );
    signal.throwIfAborted();
    this.previews.set(key, audio);
    while (this.previews.size > 6) {
      const oldest = this.previews.keys().next().value!;
      const item = this.previews.get(oldest)!;
      this.previews.delete(oldest);
      const filename = this.previewFiles.get(item.id);
      this.previewFiles.delete(item.id);
      if (filename) await rm(filename, { force: true });
    }
    return audio;
  }
  async import(
    value: unknown,
    signal: AbortSignal,
    report?: (p: OperationProgress) => void,
  ): Promise<AudioTrack> {
    const request = checkedEpidemicAsset(value),
      source = await this.source(request, signal);
    if (!source.item.stems.includes(request.stem!))
      throw new EpidemicError("This stem is not available for that audio.");
    report?.({
      phase: "downloading",
      message: `Requesting ${source.item.title}…`,
    });
    const data = await this.invoke(
      request.kind === "music" ? "DownloadRecording" : "DownloadSoundEffect",
      {
        id: request.id,
        options: {
          fileType: request.format,
          bundle: false,
          ...(request.kind === "music" ? { stemType: request.stem } : {}),
        },
      },
      signal,
    );
    const download = record(
      data[
        request.kind === "music" ? "recordingDownload" : "soundEffectDownload"
      ],
      "download",
    );
    const audio = await this.localAudio(
      download.assetUrl,
      source.item.title +
        (request.stem !== "FULL" ? ` · ${request.stem!.toLowerCase()}` : ""),
      request.format!,
      signal,
      report,
    );
    signal.throwIfAborted();
    return {
      ...audio,
      role: request.kind,
      origin: {
        provider: "epidemic-sound",
        id: request.id,
        kind: request.kind,
        artists: source.item.artists,
        stem: request.stem!,
        format: request.format!,
      },
    };
  }
}
