// models.ts — fetch + map OpenAI-compatible /models responses
import type { CompatFlags, ModelEntry } from "./config.ts";

export interface RawModel {
  id?: string;
  name?: string;
  context_window?: number;
  max_tokens?: number;
  context_length?: number;
  max_completion_tokens?: number;
  reasoning?: unknown;
  input?: unknown;
  modalities?: unknown;
  compat?: unknown;
}

export function normalizeInput(value: unknown): ("text" | "image")[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((v): v is "text" | "image" => v === "text" || v === "image");
  return kept.length > 0 ? kept : undefined;
}

/** Accept a plain object of Pi compat flags; ignore anything else (strings, arrays, null). */
export function normalizeCompat(value: unknown): CompatFlags | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.keys(value).length > 0 ? ({ ...value } as CompatFlags) : undefined;
}

export function defaultModel(id: string): ModelEntry {
  return { id, contextWindow: 128000, maxTokens: 16384, reasoning: false, input: ["text"] };
}

export function mapModel(raw: RawModel): ModelEntry | null {
  if (!raw.id || typeof raw.id !== "string") return null;
  const entry: ModelEntry = { id: raw.id };
  const cw = raw.context_window ?? raw.context_length;
  if (typeof cw === "number" && cw > 0) entry.contextWindow = cw;
  const mt = raw.max_tokens ?? raw.max_completion_tokens;
  if (typeof mt === "number" && mt > 0) entry.maxTokens = mt;
  if (typeof raw.reasoning === "boolean") entry.reasoning = raw.reasoning;
  const input = normalizeInput(raw.input ?? raw.modalities);
  if (input) entry.input = input;
  if (typeof raw.name === "string" && raw.name) entry.name = raw.name;
  const compat = normalizeCompat(raw.compat);
  if (compat) entry.compat = compat;
  return entry;
}

// Fully-populated model shape — structurally satisfies Pi's ProviderModelConfig
// (all required fields guaranteed by buildProviderModels).
export type BuiltProviderModel = ModelEntry & {
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
};

/**
 * Provider-level compat merged under each model's own compat.
 * pi's extension registerProvider() path drops models.json provider-level compat,
 * so the flags must be present on every model definition as well.
 */
export function buildProviderModels(
  models: ModelEntry[],
  providerCompat?: CompatFlags,
): BuiltProviderModel[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name ?? m.id, // Pi requires ProviderModelConfig.name; default to id (matches Pi's modelFromJson)
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 16384,
    reasoning: m.reasoning ?? false,
    input: normalizeInput(m.input) ?? ["text"],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...mergeCompat(providerCompat, m.compat),
  }));
}

function mergeCompat(providerCompat?: CompatFlags, modelCompat?: CompatFlags): { compat?: CompatFlags } {
  const merged = { ...providerCompat, ...modelCompat };
  return Object.keys(merged).length > 0 ? { compat: merged } : {};
}

/**
 * Merge a freshly fetched model list with the stored one.
 *
 * The API cannot express the fields a user sets by hand, so a blind replacement
 * silently reverts them — most visibly `compat.supportsDeveloperRole: false`,
 * whose loss brings back HTTP 422 "unknown variant `developer`" on GLM-style
 * endpoints. Rule: `compat` is always the user's; every other field the API
 * leaves out keeps its stored value, and fields the API does report win.
 */
export function mergeFetchedModels(existing: ModelEntry[], fetched: ModelEntry[]): ModelEntry[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  return fetched.map((fresh) => {
    const stored = byId.get(fresh.id);
    if (!stored) return fresh;
    const merged: Record<string, unknown> = { ...fresh };
    for (const [key, value] of Object.entries(stored)) {
      if (key === "id") continue;
      if (key === "compat" || merged[key] === undefined) merged[key] = value;
    }
    return merged as unknown as ModelEntry;
  });
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<ModelEntry[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/models`, { headers, signal });
  if (!response.ok) {
    throw new Error(`GET ${baseUrl}/models failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data?: RawModel[] };
  return (payload.data ?? []).map(mapModel).filter((m): m is ModelEntry => m !== null);
}