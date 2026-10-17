import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverCodexModels,
  loadCodexModels,
  parseModelPage,
} from "./codex-models";
import { codexArguments, resolveCodexSelection } from "./alignment";

function model(id: string, fast: "priority" | "fast" | false = false) {
  return {
    id: `provider-${id}`,
    model: id,
    displayName: `Model ${id}`,
    description: "Live provider description",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "medium" },
      { reasoningEffort: "provider-future-effort" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: id === "default-model",
    ...(fast === "priority"
      ? { serviceTiers: [{ id: "priority", name: "Fast" }] }
      : {}),
    ...(fast === "fast" ? { additionalSpeedTiers: ["fast"] } : {}),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Vandashi-compatible Codex model discovery", () => {
  it("loads every catalog page with hidden models excluded and maps both advertised fast capabilities", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [model("default-model", "priority")],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        data: [model("another-model", "fast"), model("ordinary-model")],
        nextCursor: null,
      });
    const models = await loadCodexModels({ request });
    expect(request.mock.calls).toEqual([
      ["model/list", { limit: 100, includeHidden: false, cursor: null }],
      ["model/list", { limit: 100, includeHidden: false, cursor: "page-2" }],
    ]);
    expect(models.map((entry) => [entry.id, entry.fast])).toEqual([
      ["default-model", true],
      ["another-model", true],
      ["ordinary-model", false],
    ]);
    expect(models[0]).toMatchObject({
      name: "Model default-model",
      defaultReasoning: "medium",
      isDefault: true,
      reasoning: ["low", "medium", "provider-future-effort"],
    });
  });

  it("rejects malformed metadata, repeated cursors and empty catalogs instead of inventing options", async () => {
    expect(() =>
      parseModelPage({
        data: [{ ...model("a"), supportedReasoningEfforts: "high" }],
        nextCursor: null,
      }),
    ).toThrow(/invalid model metadata/);
    await expect(
      loadCodexModels({
        request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      }),
    ).rejects.toThrow(/No Codex models/);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [model("a")], nextCursor: "repeat" })
      .mockResolvedValueOnce({ data: [model("b")], nextCursor: "repeat" });
    await expect(loadCodexModels({ request })).rejects.toThrow(
      /repeated.*cursor/,
    );
  });

  it("runs the real stdio handshake and paginated discovery through a Node launcher with a minimal PATH", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "audio-mix-model-discovery-"),
    );
    try {
      const launcher = join(directory, "codex.mjs");
      await writeFile(
        launcher,
        `#!/usr/bin/env node
import { createInterface } from 'node:readline';
const page = ${JSON.stringify(model("default-model", "priority"))};
for await (const line of createInterface({input:process.stdin})) {
 const request = JSON.parse(line);
 if (request.method === 'initialize') console.log(JSON.stringify({id:request.id,result:{}}));
 else if(request.method === 'model/list') console.log(JSON.stringify({id:request.id,result:{data:[page],nextCursor:null}}));
 else if(request.id!==undefined) console.log(JSON.stringify({id:request.id,error:{code:-32601,message:'No AI execution allowed'}}));
}
`,
        { mode: 0o700 },
      );
      vi.stubEnv("AUDIO_MIX_CODEX_PATH", launcher);
      vi.stubEnv("PATH", "/no-node-here");
      const models = await discoverCodexModels(AbortSignal.timeout(5_000));
      expect(models.map((entry) => entry.id)).toEqual(["default-model"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cancels and owns a stalled discovery subprocess through shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "audio-mix-model-cancel-"));
    try {
      const launcher = join(directory, "codex.mjs");
      await writeFile(
        launcher,
        "#!/usr/bin/env node\nsetInterval(()=>{},1000);",
        { mode: 0o700 },
      );
      vi.stubEnv("AUDIO_MIX_CODEX_PATH", launcher);
      await expect(
        discoverCodexModels(AbortSignal.timeout(50)),
      ).rejects.toThrow(/cancelled or timed out/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("validated grouping model preferences", () => {
  it("uses catalog fallback and passes the supported model, reasoning and priority tier to exec", () => {
    const models = parseModelPage({
      data: [model("default-model", "priority"), model("ordinary-model")],
      nextCursor: null,
    }).models;
    const selected = resolveCodexSelection(
      {
        model: "default-model",
        reasoning: "provider-future-effort",
        fast: true,
      },
      models,
    );
    const args = codexArguments("/work", "/schema", "/output", selected);
    expect(args[args.indexOf("--model") + 1]).toBe("default-model");
    expect(args).toContain('model_reasoning_effort="provider-future-effort"');
    expect(args).toContain('service_tier="priority"');
    const ordinary = resolveCodexSelection(
      { model: "ordinary-model", reasoning: "unsupported", fast: true },
      models,
    );
    expect(ordinary).toEqual({
      model: "ordinary-model",
      reasoning: "medium",
      fast: false,
    });
    expect(
      codexArguments("/work", "/schema", "/output", ordinary),
    ).not.toContain('service_tier="priority"');
    expect(
      resolveCodexSelection(
        { model: "removed-model", reasoning: "removed-effort", fast: false },
        models,
      ),
    ).toEqual({ model: "default-model", reasoning: "medium", fast: false });
  });

  it("never sends a fabricated effort or model when provider metadata is unusable", () => {
    expect(() => resolveCodexSelection(undefined, [])).toThrow(
      /No Codex model/,
    );
    const invalid = parseModelPage({
      data: [{ ...model("default-model"), supportedReasoningEfforts: [] }],
      nextCursor: null,
    }).models;
    expect(() => resolveCodexSelection(undefined, invalid)).toThrow(
      /supported reasoning level/,
    );
  });
});
