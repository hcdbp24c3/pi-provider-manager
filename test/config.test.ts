import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadModelsFile, saveModelsFile, validateProviderName, normalizeBaseUrl,
  addProvider, updateProvider, removeProvider, listProviders,
  loadPluginConfig, savePluginConfig,
  type ModelsFile,
} from "../config.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pm-test-"));
const MODELS = path.join(TMP, "models.json");
const PLUGIN = path.join(TMP, "plugin.json");

afterEach(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

test("loadModelsFile returns empty providers when file missing", () => {
  expect(loadModelsFile(path.join(TMP, "nope.json"))).toEqual({ providers: {} });
});

test("saveModelsFile writes and loadModelsFile reads back", () => {
  const file = { providers: { p1: { baseUrl: "https://x/v1", api: "openai-completions" as const, models: [{ id: "m1" }] } } };
  saveModelsFile(file, MODELS);
  expect(loadModelsFile(MODELS)).toEqual(file);
});

test("saveModelsFile creates .bak of previous content", () => {
  saveModelsFile({ providers: { a: { baseUrl: "https://a/v1", api: "openai-completions" as const } } }, MODELS);
  saveModelsFile({ providers: { b: { baseUrl: "https://b/v1", api: "openai-completions" as const } } }, MODELS);
  const bak = JSON.parse(fs.readFileSync(`${MODELS}.bak`, "utf8"));
  expect(bak.providers.a).toBeDefined();
});

test("validateProviderName", () => {
  expect(validateProviderName("")).not.toBeNull();
  expect(validateProviderName("my provider")).not.toBeNull();
  expect(validateProviderName("my-provider_2")).toBeNull();
});

test("normalizeBaseUrl", () => {
  expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  expect(normalizeBaseUrl("ftp://x")).toBeNull();
  expect(normalizeBaseUrl("not a url")).toBeNull();
});

test("add/update/remove/list", () => {
  let file: ModelsFile = { providers: {} };
  file = addProvider(file, "p1", { baseUrl: "https://a/v1", api: "openai-completions" });
  file = addProvider(file, "p2", { baseUrl: "https://b/v1", api: "openai-completions" });
  expect(listProviders(file).length).toBe(2);
  file = updateProvider(file, "p1", { baseUrl: "https://a2/v1", api: "openai-completions" });
  expect(file.providers.p1.baseUrl).toBe("https://a2/v1");
  file = removeProvider(file, "p1");
  expect(file.providers.p1).toBeUndefined();
  expect(listProviders(file).length).toBe(1);
});

test("plugin config defaults and round-trip", () => {
  expect(loadPluginConfig(path.join(TMP, "missing.json")).autoUpdate).toBe(true);
  savePluginConfig({ autoUpdate: false, providers: { p1: { autoUpdate: false } } }, PLUGIN);
  const cfg = loadPluginConfig(PLUGIN);
  expect(cfg.autoUpdate).toBe(false);
  expect(cfg.providers.p1.autoUpdate).toBe(false);
});