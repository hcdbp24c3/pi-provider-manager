// config.ts — pure logic: read/write ~/.pi/agent/models.json + plugin config
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Provider/model compatibility flags understood by Pi (mirrors pi-ai's ProviderCompatSchema).
 * Unknown keys are passed through so new Pi flags keep working without a plugin update.
 */
export interface CompatFlags {
  /** Send the system prompt as role "system" instead of "developer" (required by GLM, DeepSeek, relays). */
  supportsDeveloperRole?: boolean;
  [key: string]: unknown;
}

export interface ModelEntry {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: CompatFlags;
}

export type ApiMode =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface ProviderConfig {
  baseUrl: string;
  api: ApiMode;
  apiKey?: string;
  /** Applied to every model of this provider (models.json provider-level compat). */
  compat?: CompatFlags;
  models?: ModelEntry[];
}

export interface ModelsFile {
  providers: Record<string, ProviderConfig>;
}

export interface PluginConfig {
  autoUpdate: boolean;
  providers: Record<string, { autoUpdate?: boolean }>;
}

export const MODELS_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");
export const PLUGIN_CONFIG_PATH = path.join(os.homedir(), ".config", "pi-provider-manager", "config.json");

export function loadModelsFile(filePath: string = MODELS_PATH): ModelsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.providers && typeof parsed.providers === "object") {
      return parsed as ModelsFile;
    }
    return { providers: {} };
  } catch {
    return { providers: {} };
  }
}

export function saveModelsFile(file: ModelsFile, filePath: string = MODELS_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

export function validateProviderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Provider name is required";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
    return "Name must start with a letter/digit and contain only a-z A-Z 0-9 _ -";
  }
  return null;
}

export function normalizeBaseUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function addProvider(file: ModelsFile, name: string, provider: ProviderConfig): ModelsFile {
  return { ...file, providers: { ...file.providers, [name]: provider } };
}

export function updateProvider(file: ModelsFile, name: string, provider: ProviderConfig): ModelsFile {
  return addProvider(file, name, provider);
}

export function removeProvider(file: ModelsFile, name: string): ModelsFile {
  const providers = { ...file.providers };
  delete providers[name];
  return { ...file, providers };
}

export function listProviders(file: ModelsFile): Array<{ name: string; provider: ProviderConfig }> {
  return Object.entries(file.providers).map(([name, provider]) => ({ name, provider }));
}

export function loadPluginConfig(filePath: string = PLUGIN_CONFIG_PATH): PluginConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      autoUpdate: parsed.autoUpdate !== false,
      providers: parsed.providers ?? {},
    };
  } catch {
    return { autoUpdate: true, providers: {} };
  }
}

export function savePluginConfig(cfg: PluginConfig, filePath: string = PLUGIN_CONFIG_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}