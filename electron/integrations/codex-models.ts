// Codex model/list discovery and metadata mapping adapted from Vandashi (MIT).
// Copyright (c) 2026 Igor. See resources/transcription/VANDASHI-LICENSE.txt.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { CodexModelInfo } from "../../src/shared/types";
import { codexLaunch } from "./codex-launch";
import { findExecutable } from "./runtime";

export interface CodexModelRpc {
  request(method: string, params: unknown): Promise<unknown>;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 10_000
  );
}

/** Use the provider's advertised efforts and speed tiers, never an app-owned catalog. */
export function parseModelPage(value: unknown): {
  models: CodexModelInfo[];
  nextCursor: string | null;
} {
  const invalid = (): never => {
    throw new Error(
      "Codex returned invalid model metadata. Update Codex CLI and refresh the models.",
    );
  };
  if (
    !object(value) ||
    !Array.isArray(value.data) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string")
  )
    return invalid();
  if (value.data.length > 10_000) return invalid();
  const models = value.data.map((entry): CodexModelInfo => {
    if (
      !object(entry) ||
      !text(entry.model) ||
      !text(entry.displayName) ||
      typeof entry.description !== "string" ||
      !Array.isArray(entry.supportedReasoningEfforts) ||
      typeof entry.defaultReasoningEffort !== "string" ||
      typeof entry.isDefault !== "boolean"
    )
      return invalid();
    const efforts = entry.supportedReasoningEfforts.map((effort): string => {
      if (!object(effort) || !text(effort.reasoningEffort)) return invalid();
      return effort.reasoningEffort;
    });
    const tiers = entry.serviceTiers ?? [];
    const speeds = entry.additionalSpeedTiers ?? [];
    if (
      !Array.isArray(tiers) ||
      !tiers.every(
        (tier) =>
          object(tier) &&
          typeof tier.id === "string" &&
          typeof tier.name === "string",
      ) ||
      !Array.isArray(speeds) ||
      !speeds.every((speed) => typeof speed === "string")
    )
      return invalid();
    return {
      id: entry.model,
      name: entry.displayName,
      description: entry.description,
      reasoning: [...new Set(efforts)],
      defaultReasoning: entry.defaultReasoningEffort,
      isDefault: entry.isDefault,
      fast:
        tiers.some((tier) => object(tier) && tier.id === "priority") ||
        speeds.includes("fast"),
    };
  });
  return { models, nextCursor: value.nextCursor };
}

export async function loadCodexModels(
  client: CodexModelRpc,
): Promise<CodexModelInfo[]> {
  const models: CodexModelInfo[] = [];
  const cursors = new Set<string>();
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = parseModelPage(
      await client.request("model/list", {
        limit: 100,
        includeHidden: false,
        cursor,
      }),
    );
    for (const model of page.models) {
      if (ids.has(model.id))
        throw new Error(
          "Codex repeated a model in its catalog. Refresh the models and try again.",
        );
      ids.add(model.id);
      models.push(model);
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (cursors.has(cursor) || cursors.size >= 100)
        throw new Error(
          "Codex returned a repeated or oversized model-list cursor.",
        );
      cursors.add(cursor);
    }
  } while (cursor);
  if (!models.length)
    throw new Error(
      "No Codex models are available. Sign in with “codex login”, then refresh the models.",
    );
  return models;
}

/** Narrow, short-lived app-server connection. It never starts a thread or an AI turn. */
class ModelClient implements CodexModelRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly closed: Promise<void>;
  private serial = 0;
  private ended = false;
  private failure: Error | null = null;
  private buffer = "";
  private stderr = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly abort: () => void;
  private readonly ownerExit: () => void;

  constructor(
    binary: string,
    private readonly signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const launch = codexLaunch(binary, [
      "app-server",
      "--stdio",
      "-c",
      "features.apps=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.hooks=false",
      "-c",
      "features.memories=false",
      "-c",
      "features.skip_host_skill_discovery=true",
      "-c",
      "project_doc_max_bytes=0",
    ]);
    this.child = spawn(launch.command, launch.args, {
      env: launch.environment,
      stdio: "pipe",
      detached: process.platform !== "win32",
      windowsHide: true,
      shell: false,
    });
    this.closed = new Promise((resolve) => {
      this.child.once("close", () => {
        this.ended = true;
        resolve();
      });
    });
    this.abort = () => {
      this.fail(new Error("Codex model discovery was cancelled or timed out."));
      this.kill();
    };
    this.ownerExit = () => this.kill(true);
    process.once("exit", this.ownerExit);
    signal.addEventListener("abort", this.abort, { once: true });
    this.child.stdout.on("data", (bytes: Buffer) => {
      try {
        this.buffer += this.decoder.write(bytes);
        if (Buffer.byteLength(this.buffer) > 4_000_000)
          throw new Error("Codex returned an oversized model response.");
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          if (line.trim()) this.receive(JSON.parse(line));
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        this.kill();
      }
    });
    this.child.stderr.on("data", (bytes: Buffer) => {
      this.stderr = (this.stderr + bytes.toString("utf8")).slice(-8_000);
    });
    this.child.stdin.on("error", (error) => {
      this.fail(error);
      this.kill();
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", () => {
      this.fail(
        new Error(
          this.stderr.trim() ||
            "Codex closed before model discovery completed.",
        ),
      );
    });
    if (signal.aborted) this.abort();
  }

  private kill(force = false): void {
    if (!this.child.pid) return;
    try {
      if (process.platform === "win32")
        this.child.kill(force ? "SIGKILL" : "SIGTERM");
      else process.kill(-this.child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* Already closed. */
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
  }

  private write(value: unknown): void {
    if (this.failure || this.ended)
      throw this.failure ?? new Error("Codex model connection is closed.");
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private receive(value: unknown): void {
    if (!object(value))
      throw new Error("Codex returned an invalid model response.");
    if (typeof value.method === "string") {
      if (value.id !== undefined)
        this.write({
          id: value.id,
          error: {
            code: -32601,
            message:
              "Model discovery does not allow interactive requests or tool execution.",
          },
        });
      return;
    }
    if (typeof value.id !== "number") return;
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    if (object(value.error))
      pending.reject(
        new Error(
          typeof value.error.message === "string"
            ? value.error.message
            : "Codex model discovery failed.",
        ),
      );
    else pending.resolve(value.result);
  }

  request(method: string, params: unknown): Promise<unknown> {
    this.signal.throwIfAborted();
    if (this.failure || this.ended)
      return Promise.reject(
        this.failure ?? new Error("Codex model connection is closed."),
      );
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "audio_mix_studio",
        title: "Audio Mix Studio",
        version: "0.2.0",
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.write({ method: "initialized" });
  }

  async close(): Promise<void> {
    this.signal.removeEventListener("abort", this.abort);
    this.fail(new Error("Codex model connection was closed."));
    this.child.stdin.end();
    this.kill();
    const force = setTimeout(() => this.kill(true), 2_000);
    force.unref();
    try {
      await this.closed;
    } finally {
      clearTimeout(force);
      process.removeListener("exit", this.ownerExit);
    }
  }
}

export async function discoverCodexModels(
  operationSignal?: AbortSignal,
): Promise<CodexModelInfo[]> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(operationSignal ? [operationSignal] : []),
  ]);
  const binary = await findExecutable("codex");
  if (!binary)
    throw new Error(
      "Codex CLI is not installed. Install Codex and sign in, then refresh the models.",
    );
  const client = new ModelClient(binary, signal);
  try {
    await client.initialize();
    return await loadCodexModels(client);
  } finally {
    await client.close();
  }
}
