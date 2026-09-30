// commands.ts — /provider subcommand handlers + auto-update
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  loadModelsFile, saveModelsFile, loadPluginConfig,
  addProvider, updateProvider, removeProvider, listProviders,
  validateProviderName, normalizeBaseUrl,
  type ModelsFile, type ProviderConfig, type ModelEntry, type ApiMode, type CompatFlags,
} from "./config.ts";
import { fetchModels, buildProviderModels, mergeFetchedModels } from "./models.ts";

export const API_MODES: Array<{ value: ApiMode; label: string }> = [
  { value: "openai-completions", label: "OpenAI Chat Completions (compatible)" },
  { value: "openai-responses", label: "OpenAI Responses API" },
  { value: "anthropic-messages", label: "Claude (Anthropic Messages)" },
  { value: "google-generative-ai", label: "Google Gemini" },
];

const SUBCOMMANDS: Array<{ value: string; label: string; description: string }> = [
  { value: "add", label: "add", description: "Add a new provider (wizard)" },
  { value: "list", label: "list", description: "List providers and view details" },
  { value: "edit", label: "edit", description: "Edit a provider" },
  { value: "delete", label: "delete", description: "Delete a provider" },
  { value: "update-models", label: "update-models", description: "Refresh model list (all or one)" },
];

const NAME_SUBCOMMANDS = new Set(["edit", "delete", "rm", "remove", "update-models", "refresh"]);

/** Argument completions for /provider — suggests subcommands, then provider names. */
export async function getProviderArgumentCompletions(argumentPrefix: string, filePath?: string) {
  const trimmed = argumentPrefix.trimStart();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const sub = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");

  // No subcommand yet → suggest subcommands, filtered by what is typed
  if (!trimmed.includes(" ")) {
    return SUBCOMMANDS
      .filter((c) => c.value.startsWith(trimmed))
      .map((c) => ({ value: c.value, label: c.label, description: c.description }));
  }

  // Subcommand + space → suggest provider names for name-taking subcommands
  if (NAME_SUBCOMMANDS.has(sub)) {
    const file = loadModelsFile(filePath);
    return Object.keys(file.providers)
      .filter((n) => n.startsWith(rest))
      .map((n) => ({ value: n, label: n, description: "Provider" }));
  }

  return null;
}

const SYSTEM_ROLE_OPTION = "System role";
const DEVELOPER_ROLE_OPTION = "Developer role (OpenAI default)";

/** Only the OpenAI-shaped APIs carry an instruction role at all. */
function hasInstructionRole(api: ApiMode): boolean {
  return api === "openai-completions" || api === "openai-responses";
}

/**
 * GLM (Z.AI), DeepSeek and most relay gateways only accept
 * system|user|assistant|tool, but Pi sends the instruction message as role
 * "developer" for reasoning models unless told otherwise — such a request is
 * rejected up front with HTTP 422 "unknown variant `developer`".
 */
async function pickInstructionRole(
  ctx: ExtensionCommandContext,
  current?: CompatFlags,
): Promise<CompatFlags | undefined> {
  const usesSystemRole = current?.supportsDeveloperRole === false;
  const choice = await ctx.ui.select("Instruction role (system vs developer):", [
    usesSystemRole ? `${SYSTEM_ROLE_OPTION} (current)` : SYSTEM_ROLE_OPTION,
    usesSystemRole ? DEVELOPER_ROLE_OPTION : `${DEVELOPER_ROLE_OPTION} (current)`,
  ]);
  if (!choice) return current; // cancelled → keep current
  return { ...current, supportsDeveloperRole: !choice.startsWith(SYSTEM_ROLE_OPTION) };
}

export function applyProvider(pi: ExtensionAPI, name: string, provider: ProviderConfig): void {
  pi.registerProvider(name, {
    name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey, // undefined = keyless; do NOT pass "" (Pi treats "" as a configured key)
    api: provider.api,
    models: buildProviderModels(provider.models ?? [], provider.compat),
  });
}

export function removeProviderRuntime(pi: ExtensionAPI, name: string): void {
  pi.unregisterProvider(name);
}

export function requireUI(ctx: ExtensionCommandContext): boolean {
  if (ctx.hasUI) return true;
  console.warn("pi-provider-manager: /provider requires an interactive UI (run in the Pi TUI).");
  return false;
}

/** Injectable dependencies for command handlers (used by tests). */
export interface CommandDeps {
  fetcher?: typeof fetchModels;
  filePath?: string;
}

async function pickApiMode(ctx: ExtensionCommandContext, current?: ApiMode): Promise<ApiMode | undefined> {
  const choice = await ctx.ui.select(
    "API mode:",
    API_MODES.map((m) => (m.value === current ? `${m.label} (current)` : m.label)),
  );
  if (!choice) return current;
  const label = choice.replace(/ \(current\)$/, "");
  return API_MODES.find((m) => m.label === label)?.value ?? current;
}

async function promptBaseUrl(ctx: ExtensionCommandContext, current?: string): Promise<string | undefined> {
  const input = await ctx.ui.input("Base URL (e.g. https://api.example.com/v1):", current ?? "");
  if (!(input ?? "").trim()) return current; // cancel/empty → keep current (undefined → caller aborts)
  const normalized = normalizeBaseUrl(input!);
  if (!normalized) {
    ctx.ui.notify("Invalid base URL (must be http(s)://...).", "error");
    return undefined;
  }
  return normalized;
}

async function promptApiKey(ctx: ExtensionCommandContext, current?: string): Promise<string | undefined> {
  // NOTE: no placeholder with current key — ctx.ui.input has no secret mode; never echo the key
  const input = await ctx.ui.input(
    "API key (use $ENV_VAR for env var, or paste literal; empty = keep current / keyless):",
    "",
  );
  if (input === undefined) return current; // cancelled → keep current
  return input.trim() || current; // empty → keep current (undefined = keyless)
}

async function collectModels(
  ctx: ExtensionCommandContext,
  baseUrl: string,
  apiKey: string | undefined,
): Promise<ModelEntry[]> {
  let models: ModelEntry[] = [];
  try {
    models = await fetchModels(baseUrl, apiKey, AbortSignal.timeout(15000));
    ctx.ui.notify(`Fetched ${models.length} model(s) from ${baseUrl}/models`, "info");
  } catch (err) {
    ctx.ui.notify(`Could not fetch models: ${(err as Error).message}`, "warning");
  }
  if (models.length === 0) {
    const manual = await ctx.ui.input("Enter model IDs (comma-separated), or leave empty to skip:", "");
    models = (manual ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((id) => ({ id }));
  }
  const edit = await ctx.ui.confirm("Edit models manually?", "Open editor to adjust JSON (contextWindow, maxTokens, reasoning, input)?");
  if (edit) {
    const text = await ctx.ui.editor("Models JSON:", JSON.stringify(models, null, 2));
    try {
      const parsed = JSON.parse(text ?? "");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      models = parsed.filter((m: any) => m && typeof m.id === "string");
    } catch (err) {
      ctx.ui.notify(`Invalid JSON, keeping previous list: ${(err as Error).message}`, "warning");
    }
  }
  return models;
}

export async function cmdAdd(pi: ExtensionAPI, nameArg: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!requireUI(ctx)) return;
  let name = nameArg.trim();
  if (!name) {
    const input = await ctx.ui.input("Provider name:", "");
    if (input === undefined) return; // cancelled
    name = input.trim();
  }
  const nameErr = validateProviderName(name);
  if (nameErr) { ctx.ui.notify(nameErr, "error"); return; }

  const file = loadModelsFile();
  if (file.providers[name]) {
    ctx.ui.notify(`Provider "${name}" already exists. Use /provider edit ${name}.`, "error");
    return;
  }

  const api = await pickApiMode(ctx);
  if (!api) return;
  const baseUrl = await promptBaseUrl(ctx);
  if (!baseUrl) return;
  const apiKey = await promptApiKey(ctx);
  const models = await collectModels(ctx, baseUrl, apiKey);
  if (models.length === 0) {
    ctx.ui.notify("Provider added with 0 models — run /provider update-models later to fetch them.", "warning");
  }

  const compat = hasInstructionRole(api) ? await pickInstructionRole(ctx) : undefined;
  const provider: ProviderConfig = { baseUrl, api, apiKey, compat, models };
  saveModelsFile(addProvider(file, name, provider));
  applyProvider(pi, name, provider);
  ctx.ui.notify(`Added provider "${name}" (${models.length} models). Available in /model now.`, "info");
}

export async function cmdList(_pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps = {}): Promise<void> {
  if (!requireUI(ctx)) return;
  const entries = listProviders(loadModelsFile(deps.filePath));
  if (entries.length === 0) {
    ctx.ui.notify("No providers configured. Use /provider add <name>.", "info");
    return;
  }
  const labels = entries.map(({ name, provider }) =>
    `${name}  [${provider.api}]  ${provider.models?.length ?? 0} models  ${provider.baseUrl}`);
  // Primary display: a select dialog (renders reliably in the TUI). Picking a provider shows its details.
  ctx.ui.setWidget("pi-provider-manager", labels);
  const choice = await ctx.ui.select("Providers:", labels);
  if (!choice) return;
  const idx = labels.indexOf(choice);
  const entry = idx >= 0 ? entries[idx] : entries.find((e) => e.name === choice);
  if (!entry) return;
  const { name, provider } = entry;
  const detailText = [
    `Provider: ${name}`,
    `API: ${provider.api}`,
    `Base URL: ${provider.baseUrl}`,
    `API key: ${provider.apiKey ? (provider.apiKey.startsWith("$") ? provider.apiKey : "(set)") : "(none)"}`,
    `Models (${provider.models?.length ?? 0}):`,
    ...(provider.models ?? []).map((m) => `  - ${m.id}`),
  ].join("\n");
  await ctx.ui.editor(`Provider "${name}" details (Esc to close):`, detailText);
}

export async function cmdEdit(pi: ExtensionAPI, nameArg: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!requireUI(ctx)) return;
  const file = loadModelsFile();
  let name = nameArg.trim();
  if (!name) {
    const names = Object.keys(file.providers);
    if (names.length === 0) { ctx.ui.notify("No providers configured.", "info"); return; }
    const choice = await ctx.ui.select("Provider:", names);
    if (!choice) return;
    name = choice;
  }
  const existing = file.providers[name];
  if (!existing) { ctx.ui.notify(`Provider "${name}" not found.`, "error"); return; }

  const api = await pickApiMode(ctx, existing.api);
  const baseUrl = await promptBaseUrl(ctx, existing.baseUrl);
  if (!baseUrl) return;
  const apiKey = await promptApiKey(ctx, existing.apiKey);

  const refetch = await ctx.ui.confirm("Re-fetch models from API?", "Fetch latest model list from the provider?");
  let models = existing.models ?? [];
  if (refetch) {
    try {
      const fetched = await fetchModels(baseUrl, apiKey, AbortSignal.timeout(15000));
      if (fetched.length > 0) models = mergeFetchedModels(existing.models ?? [], fetched);
      else ctx.ui.notify("No models returned; keeping existing list.", "warning");
    } catch (err) {
      ctx.ui.notify(`Fetch failed, keeping existing list: ${(err as Error).message}`, "warning");
    }
  }
  const edit = await ctx.ui.confirm("Edit models manually?", "Open editor to adjust JSON?");
  if (edit) {
    const text = await ctx.ui.editor("Models JSON:", JSON.stringify(models, null, 2));
    try {
      const parsed = JSON.parse(text ?? "");
      if (!Array.isArray(parsed)) throw new Error("not an array");
      models = parsed.filter((m: any) => m && typeof m.id === "string");
    } catch (err) {
      ctx.ui.notify(`Invalid JSON, keeping previous list: ${(err as Error).message}`, "warning");
    }
  }

  const finalApi = api ?? existing.api;
  const compat = hasInstructionRole(finalApi)
    ? await pickInstructionRole(ctx, existing.compat)
    : existing.compat;
  const provider: ProviderConfig = { baseUrl, api: finalApi, apiKey, compat, models };
  saveModelsFile(updateProvider(file, name, provider));
  applyProvider(pi, name, provider);
  ctx.ui.notify(`Updated provider "${name}" (${models.length} models).`, "info");
}

export async function cmdDelete(pi: ExtensionAPI, nameArg: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!requireUI(ctx)) return;
  const file = loadModelsFile();
  let name = nameArg.trim();
  if (!name) {
    const names = Object.keys(file.providers);
    if (names.length === 0) { ctx.ui.notify("No providers configured.", "info"); return; }
    const choice = await ctx.ui.select("Provider:", names);
    if (!choice) return;
    name = choice;
  }
  if (!file.providers[name]) { ctx.ui.notify(`Provider "${name}" not found.`, "error"); return; }
  const ok = await ctx.ui.confirm(`Delete provider "${name}"?`, "Removes it from models.json and unregisters it.");
  if (!ok) return;
  saveModelsFile(removeProvider(file, name));
  removeProviderRuntime(pi, name);
  ctx.ui.notify(`Deleted provider "${name}".`, "info");
}

export async function cmdUpdateModels(
  pi: ExtensionAPI,
  nameArg: string,
  ctx: ExtensionCommandContext,
  deps: CommandDeps = {},
): Promise<void> {
  if (!requireUI(ctx)) return;
  const fetcher = deps.fetcher ?? fetchModels;
  const file = loadModelsFile(deps.filePath);
  let name = nameArg.trim();
  if (!name) {
    const names = Object.keys(file.providers);
    if (names.length === 0) { ctx.ui.notify("No providers configured.", "info"); return; }
    const choice = await ctx.ui.select("Provider:", ["* All providers", ...names]);
    if (!choice) return;
    if (choice === "* All providers") {
      await updateAllProviders(pi, ctx, deps);
      return;
    }
    name = choice;
  }
  const provider = file.providers[name];
  if (!provider) { ctx.ui.notify(`Provider "${name}" not found.`, "error"); return; }
  try {
    const models = mergeFetchedModels(provider.models ?? [], await fetcher(provider.baseUrl, provider.apiKey, AbortSignal.timeout(15000)));
    if (models.length === 0) { ctx.ui.notify("No models returned; keeping existing list.", "warning"); return; }
    const updated = { ...provider, models };
    saveModelsFile(updateProvider(file, name, updated), deps.filePath);
    applyProvider(pi, name, updated);
    ctx.ui.notify(`Updated "${name}": ${models.length} models.`, "info");
  } catch (err) {
    ctx.ui.notify(`Update failed: ${(err as Error).message}`, "error");
  }
}

async function updateAllProviders(pi: ExtensionAPI, ctx: ExtensionCommandContext, deps: CommandDeps): Promise<void> {
  const fetcher = deps.fetcher ?? fetchModels;
  const file = loadModelsFile(deps.filePath);
  const entries = listProviders(file);
  if (entries.length === 0) { ctx.ui.notify("No providers configured.", "info"); return; }
  const working: ModelsFile = { providers: { ...file.providers } };
  const ok: string[] = [];
  const failed: string[] = [];
  await Promise.allSettled(entries.map(async ({ name, provider }) => {
    try {
      const models = mergeFetchedModels(
        provider.models ?? [],
        await fetcher(provider.baseUrl, provider.apiKey, AbortSignal.timeout(15000)),
      );
      if (models.length === 0) throw new Error("no models returned");
      working.providers[name] = { ...provider, models };
      applyProvider(pi, name, working.providers[name]);
      ok.push(name);
    } catch {
      failed.push(name);
    }
  }));
  if (ok.length > 0) saveModelsFile(working, deps.filePath);
  const summary = `Updated ${ok.length}/${entries.length} provider(s)`
    + (ok.length ? `: ${ok.join(", ")}` : "")
    + (failed.length ? `; failed: ${failed.join(", ")}` : "") + ".";
  ctx.ui.notify(summary, failed.length ? "warning" : "info");
}

export async function autoUpdateProviders(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const cfg = loadPluginConfig();
  if (!cfg.autoUpdate) return;
  const file = loadModelsFile();
  const entries = listProviders(file);
  if (entries.length === 0) return;

  const working: ModelsFile = { providers: { ...file.providers } };
  let changedCount = 0;
  let failedCount = 0;
  const changedNames: string[] = [];

  await Promise.allSettled(entries.map(async ({ name, provider }) => {
    if (cfg.providers[name]?.autoUpdate === false) return;
    try {
      const models = mergeFetchedModels(provider.models ?? [], await fetchModels(provider.baseUrl, provider.apiKey, AbortSignal.timeout(10000)));
      // Compare by model-id set only — metadata edits stay as the user left them (mergeFetchedModels)
      const oldIds = (provider.models ?? []).map((m) => m.id).sort().join("\n");
      const newIds = models.map((m) => m.id).sort().join("\n");
      if (oldIds !== newIds) {
        working.providers[name] = { ...provider, models };
        applyProvider(pi, name, working.providers[name]);
        changedCount++;
        changedNames.push(name);
      }
    } catch {
      failedCount++;
    }
  }));

  if (changedCount > 0) {
    saveModelsFile(working);
    if (ctx.hasUI) ctx.ui.notify(`Auto-updated models for: ${changedNames.join(", ")}`, "info");
  }
  if (failedCount > 0 && ctx.hasUI) {
    ctx.ui.notify(`${failedCount} provider(s) could not be refreshed (kept existing models).`, "warning");
  }
}