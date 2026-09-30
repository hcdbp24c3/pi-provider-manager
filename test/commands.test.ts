import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const commands = await import("../commands.ts");
const { saveModelsFile } = await import("../config.ts");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pm-cmd-"));
const MODELS_PATH = path.join(TMP, "models.json");

const baseProviders = {
  alpha: {
    baseUrl: "https://a.example.com/v1",
    api: "openai-completions",
    apiKey: "$KEY_A",
    models: [{ id: "a1" }],
  },
  beta: {
    baseUrl: "https://b.example.com/v1",
    api: "anthropic-messages",
    models: [],
  },
};

// --- test state ---
let fetchResults: Record<string, any[]> = {};
let selectResult: string | undefined;
const notified: Array<{ message: string; type?: string }> = [];
const applied: Array<{ name: string; provider: any }> = [];

async function mockFetcher(baseUrl: string): Promise<any[]> {
  return fetchResults[baseUrl] ?? [];
}

function makeCtx() {
  return {
    hasUI: true,
    ui: {
      select: async () => selectResult,
      confirm: async () => false,
      input: async () => undefined,
      editor: async () => undefined,
      notify: (message: string, type?: string) => { notified.push({ message, type }); },
      setWidget: () => {},
      setStatus: () => {},
    },
  };
}

const fakePi: any = {
  registerProvider: (name: string, _cfg: any) => { applied.push({ name, provider: _cfg }); },
  unregisterProvider: (_name: string) => {},
};

beforeEach(() => {
  fs.mkdirSync(path.dirname(MODELS_PATH), { recursive: true });
  saveModelsFile({ providers: JSON.parse(JSON.stringify(baseProviders)) }, MODELS_PATH);
  fetchResults = {};
  selectResult = undefined;
  notified.length = 0;
  applied.length = 0;
});

afterEach(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe("getProviderArgumentCompletions", () => {
  test("empty prefix suggests all subcommands", async () => {
    const items = await commands.getProviderArgumentCompletions("");
    expect(items?.map((i) => i.value)).toEqual(["add", "list", "edit", "delete", "update-models"]);
  });

  test("partial subcommand prefix filters suggestions", async () => {
    const items = await commands.getProviderArgumentCompletions("upd");
    expect(items?.map((i) => i.value)).toEqual(["update-models"]);
  });

  test("name-taking subcommand suggests provider names", async () => {
    const items = await commands.getProviderArgumentCompletions("edit ", MODELS_PATH);
    expect(items?.map((i) => i.value)).toEqual(["alpha", "beta"]);
    const filtered = await commands.getProviderArgumentCompletions("delete al", MODELS_PATH);
    expect(filtered?.map((i) => i.value)).toEqual(["alpha"]);
  });

  test("add subcommand returns no name suggestions", async () => {
    const items = await commands.getProviderArgumentCompletions("add ");
    expect(items).toBeNull();
  });
});

describe("cmdList", () => {
  test("shows provider list via select dialog (no count-only notify)", async () => {
    const ctx: any = makeCtx();
    selectResult = undefined; // user cancels
    await commands.cmdList(fakePi, ctx, { filePath: MODELS_PATH });
    expect(notified.length).toBe(0); // list is shown via dialog, not notify
  });

  test("picking a provider opens details in editor", async () => {
    const ctx: any = makeCtx();
    const labels = [
      "alpha  [openai-completions]  1 models  https://a.example.com/v1",
      "beta  [anthropic-messages]  0 models  https://b.example.com/v1",
    ];
    selectResult = labels[0];
    const editorCalls: string[] = [];
    ctx.ui.editor = async (title: string, content: string) => { editorCalls.push(`${title}\n${content}`); return undefined; };
    await commands.cmdList(fakePi, ctx, { filePath: MODELS_PATH });
    expect(editorCalls.length).toBe(1);
    expect(editorCalls[0]).toContain('Provider "alpha" details');
    expect(editorCalls[0]).toContain("https://a.example.com/v1");
    expect(editorCalls[0]).toContain("- a1");
  });
});

describe("cmdUpdateModels", () => {
  test("no name + pick '* All providers' → fetches and updates ALL providers", async () => {
    fetchResults = {
      "https://a.example.com/v1": [{ id: "a1" }, { id: "a2" }],
      "https://b.example.com/v1": [{ id: "b1" }],
    };
    selectResult = "* All providers";
    const ctx: any = makeCtx();
    await commands.cmdUpdateModels(fakePi, "", ctx, { fetcher: mockFetcher, filePath: MODELS_PATH });
    const saved = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    expect(saved.providers.alpha.models).toEqual([{ id: "a1" }, { id: "a2" }]);
    expect(saved.providers.beta.models).toEqual([{ id: "b1" }]);
    expect(applied.length).toBe(2);
    expect(notified.some((n) => n.message.includes("Updated 2/2 provider(s)"))).toBe(true);
  });

  test("no name + pick a specific provider → updates ONLY that provider", async () => {
    fetchResults = {
      "https://a.example.com/v1": [{ id: "a1" }, { id: "a2" }],
      "https://b.example.com/v1": [{ id: "b1" }],
    };
    selectResult = "alpha";
    const ctx: any = makeCtx();
    await commands.cmdUpdateModels(fakePi, "", ctx, { fetcher: mockFetcher, filePath: MODELS_PATH });
    const saved = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    expect(saved.providers.alpha.models).toEqual([{ id: "a1" }, { id: "a2" }]);
    expect(saved.providers.beta.models).toEqual([]); // untouched
    expect(applied.length).toBe(1);
    expect(notified.some((n) => n.message.includes('Updated "alpha": 2 models'))).toBe(true);
  });

  test("with explicit name → updates ONLY that provider", async () => {
    fetchResults = {
      "https://b.example.com/v1": [{ id: "b1" }, { id: "b2" }],
    };
    const ctx: any = makeCtx();
    await commands.cmdUpdateModels(fakePi, "beta", ctx, { fetcher: mockFetcher, filePath: MODELS_PATH });
    const saved = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    expect(saved.providers.beta.models).toEqual([{ id: "b1" }, { id: "b2" }]);
    expect(saved.providers.alpha.models).toEqual([{ id: "a1" }]); // untouched
    expect(applied.length).toBe(1);
  });

  test("all-providers: a failing provider is reported but does not block others", async () => {
    fetchResults = {
      "https://a.example.com/v1": [{ id: "a1" }, { id: "a2" }],
      // beta missing → fetcher returns [] → treated as failure
    };
    selectResult = "* All providers";
    const ctx: any = makeCtx();
    await commands.cmdUpdateModels(fakePi, "", ctx, { fetcher: mockFetcher, filePath: MODELS_PATH });
    const saved = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    expect(saved.providers.alpha.models).toEqual([{ id: "a1" }, { id: "a2" }]);
    expect(saved.providers.beta.models).toEqual([]); // unchanged
    expect(notified.some((n) => n.message.includes("Updated 1/2 provider(s)") && n.message.includes("failed: beta"))).toBe(true);
  });

  test("refetch keeps provider compat and re-applies it to runtime models", async () => {
    // Regression: an endpoint that rejects role "developer" needs compat.supportsDeveloperRole=false.
    // A refetch must not drop it, and the re-registered provider must still carry it.
    const file = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    file.providers.alpha.compat = { supportsDeveloperRole: false };
    file.providers.alpha.models = [{ id: "a1", reasoning: true, compat: { supportsDeveloperRole: false } }];
    fs.writeFileSync(MODELS_PATH, JSON.stringify(file, null, 2));
    fetchResults = { "https://a.example.com/v1": [{ id: "a1" }, { id: "a2" }] };

    const ctx: any = makeCtx();
    await commands.cmdUpdateModels(fakePi, "alpha", ctx, { fetcher: mockFetcher, filePath: MODELS_PATH });

    const saved = JSON.parse(fs.readFileSync(MODELS_PATH, "utf8"));
    expect(saved.providers.alpha.compat).toEqual({ supportsDeveloperRole: false });
    expect(saved.providers.alpha.models[0].compat).toEqual({ supportsDeveloperRole: false });
    const runtime = applied.find((a) => a.name === "alpha")?.provider;
    expect(runtime.models[0].compat).toEqual({ supportsDeveloperRole: false });
    expect(runtime.models[1].compat).toEqual({ supportsDeveloperRole: false });
  });
});
