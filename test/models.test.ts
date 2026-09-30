import { describe, test, expect } from "bun:test";
import {
  normalizeInput, mapModel, defaultModel, buildProviderModels, fetchModels, mergeFetchedModels,
} from "../models.ts";

test("normalizeInput", () => {
  expect(normalizeInput(["text", "image"])).toEqual(["text", "image"]);
  expect(normalizeInput(["text", "video"])).toEqual(["text"]);
  expect(normalizeInput("text")).toBeUndefined();
  expect(normalizeInput(undefined)).toBeUndefined();
});

test("mapModel maps standard + extended fields", () => {
  const m = mapModel({ id: "gpt-4o", context_window: 128000, max_tokens: 4096, reasoning: true, input: ["text", "image"], name: "GPT-4o" });
  expect(m).toEqual({ id: "gpt-4o", contextWindow: 128000, maxTokens: 4096, reasoning: true, input: ["text", "image"], name: "GPT-4o" });
});

test("mapModel maps context_length/max_completion_tokens", () => {
  const m = mapModel({ id: "m", context_length: 200000, max_completion_tokens: 8192 });
  expect(m?.contextWindow).toBe(200000);
  expect(m?.maxTokens).toBe(8192);
});

test("mapModel returns null for missing id", () => {
  expect(mapModel({})).toBeNull();
});

test("defaultModel fills conservative defaults", () => {
  expect(defaultModel("m")).toEqual({ id: "m", contextWindow: 128000, maxTokens: 16384, reasoning: false, input: ["text"] });
});

test("buildProviderModels fills defaults + cost", () => {
  const built = buildProviderModels([{ id: "m" }]);
  expect(built[0]).toEqual({ id: "m", name: "m", contextWindow: 128000, maxTokens: 16384, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
});

test("buildProviderModels omits compat when unset", () => {
  expect("compat" in buildProviderModels([{ id: "m" }])[0]).toBe(false);
});

test("buildProviderModels keeps per-model compat", () => {
  const built = buildProviderModels([{ id: "glm", compat: { supportsDeveloperRole: false } }]);
  expect(built[0].compat).toEqual({ supportsDeveloperRole: false });
});

test("buildProviderModels merges provider-level compat into every model", () => {
  const built = buildProviderModels([{ id: "a" }, { id: "b", compat: { supportsDeveloperRole: true } }], {
    supportsDeveloperRole: false,
  });
  expect(built[0].compat).toEqual({ supportsDeveloperRole: false });
  // per-model entry wins over the provider-level default
  expect(built[1].compat).toEqual({ supportsDeveloperRole: true });
});

test("mapModel keeps compat returned by the API", () => {
  expect(mapModel({ id: "m", compat: { supportsDeveloperRole: false } })?.compat).toEqual({
    supportsDeveloperRole: false,
  });
  expect(mapModel({ id: "m", compat: "nope" })?.compat).toBeUndefined();
});

describe("mergeFetchedModels", () => {
  test("preserves compat so a developer-role opt-out survives a refetch", () => {
    const existing = [{ id: "glm-4.6", reasoning: true, compat: { supportsDeveloperRole: false } }];
    const merged = mergeFetchedModels(existing, [{ id: "glm-4.6" }]);
    expect(merged[0].compat).toEqual({ supportsDeveloperRole: false });
  });

  test("keeps manual fields the API does not report, prefers API values when present", () => {
    const existing = [{ id: "m", contextWindow: 200000, input: ["text", "image"], name: "Manual" }];
    const merged = mergeFetchedModels(existing, [{ id: "m", contextWindow: 128000, name: "API" }]);
    expect(merged[0].contextWindow).toBe(128000); // API wins
    expect(merged[0].name).toBe("API"); // API wins
    expect(merged[0].input).toEqual(["text", "image"]); // API silent → manual kept
  });

  test("adds new ids and drops ids the API no longer returns", () => {
    const merged = mergeFetchedModels([{ id: "old" }, { id: "keep" }], [{ id: "keep" }, { id: "new" }]);
    expect(merged.map((m) => m.id)).toEqual(["keep", "new"]);
  });
});

test("fetchModels parses /models response with Bearer auth", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    expect(String(url)).toBe("https://x/v1/models");
    expect(init?.headers?.Authorization).toBe("Bearer sk-test");
    return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b", context_window: 999 }] }), { status: 200 });
  }) as any;
  try {
    const models = await fetchModels("https://x/v1", "sk-test");
    expect(models.length).toBe(2);
    expect(models[1].contextWindow).toBe(999);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchModels throws on non-200", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 401 })) as any;
  try {
    await expect(fetchModels("https://x/v1", "k")).rejects.toThrow(/401/);
  } finally {
    globalThis.fetch = original;
  }
});