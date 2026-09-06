// models.ts — fetch + map OpenAI-compatible /models responses
import type { ModelEntry } from "./config.ts";

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
}

export function normalizeInput(value: unknown): ("text" | "image")[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((v): v is "text" | "image" => v === "text" || v === "image");
  return kept.length > 0 ? kept : undefined;
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

export function buildProviderModels(models: ModelEntry[]): BuiltProviderModel[] {
  return models.map((m) => ({
    id: m.id,
    name: m.name ?? m.id, // Pi requires ProviderModelConfig.name; default to id (matches Pi's modelFromJson)
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 16384,
    reasoning: m.reasoning ?? false,
    input: normalizeInput(m.input) ?? ["text"],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
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