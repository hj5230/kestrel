// Model facts (context, output limit, prices, effort lists) from the models.dev catalog, cached in
// the data folder and refreshed daily, plus the local Codex cache for ChatGPT-subscription slugs.
// Only fields still at their generic default are filled, so values a person set survive a refresh.
import fs from "node:fs";
import path from "node:path";
import { sortEfforts } from "../shared/effort";
import type { ModelConfig, ProviderKind } from "../shared/protocol";
import { HOME } from "./env";

const CATALOG_URL = "https://models.dev/api.json";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONTEXT_DEFAULT = 128_000;
const MAX_DEFAULT = 16_384;

/** What one catalog row knows. `efforts` is empty when the model has no effort enum (a switch or a token budget). */
export interface CatalogFacts {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  vision?: boolean;
  reasoning?: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  efforts: string[];
  effortDefault?: string | null;
}

interface Entry {
  name?: string;
  contextWindow: number;
  maxTokens: number;
  vision: boolean;
  reasoning: boolean;
  cost: CatalogFacts["cost"];
  efforts: string[];
}

interface CodexRow {
  contextWindow: number;
  vision: boolean;
  efforts: string[];
  effortDefault: string | null;
}

const OFFICIAL: Partial<Record<ProviderKind, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  openrouter: "openrouter",
  ollama: "ollama",
};

let byProvider = new Map<string, Map<string, Entry>>();
let byApi = new Map<string, string>();
let byModelId = new Map<string, Entry[]>();
let loaded = false;

export function endpointKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

/** Ids to try, most specific first: the raw id, without a vendor prefix, without `[1m]`, without a date suffix. */
export function modelKeys(id: string): string[] {
  const raw = id.trim();
  const bare = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const noLong = bare.replace(/\[1m\]$/i, "");
  const noDate = noLong.replace(/-\d{4}-?\d{2}-?\d{2}$/, "").replace(/-\d{8}$/, "");
  return [...new Set([raw, bare, noLong, noDate].filter(Boolean))];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function parseEntry(model: any): Entry | null {
  const contextWindow = num(model?.limit?.context);
  if (!contextWindow) return null;
  const efforts: string[] = [];
  for (const option of model?.reasoning_options ?? []) {
    if (option?.type !== "effort" || !Array.isArray(option.values)) continue;
    for (const value of option.values) if (typeof value === "string" && value.trim()) efforts.push(value);
  }
  const input: string[] = model?.modalities?.input ?? [];
  const cost = model?.cost;
  const priced = cost && (num(cost.input) > 0 || num(cost.output) > 0);
  return {
    name: typeof model?.name === "string" ? model.name : undefined,
    contextWindow,
    maxTokens: num(model?.limit?.output),
    vision: input.some((item) => String(item).includes("image")) || model?.attachment === true,
    reasoning: !!model?.reasoning || efforts.length > 0,
    efforts: sortEfforts(efforts),
    cost: priced
      ? { input: num(cost.input), output: num(cost.output), cacheRead: num(cost.cache_read), cacheWrite: num(cost.cache_write) }
      : null,
  };
}

/** Replaces the in-memory index. `raw` is the body of https://models.dev/api.json. */
export function installCatalog(raw: unknown): void {
  byProvider = new Map();
  byApi = new Map();
  byModelId = new Map();
  loaded = true;
  if (!raw || typeof raw !== "object") return;
  for (const [providerId, provider] of Object.entries(raw as Record<string, any>)) {
    const models = provider?.models;
    if (!models || typeof models !== "object") continue;
    const table = new Map<string, Entry>();
    for (const [id, model] of Object.entries(models)) {
      const entry = parseEntry(model);
      if (!entry) continue;
      table.set(id, entry);
      const list = byModelId.get(id) ?? [];
      list.push(entry);
      byModelId.set(id, list);
    }
    if (!table.size) continue;
    byProvider.set(providerId, table);
    const api = endpointKey(provider?.api ?? "");
    if (api && !byApi.has(api)) byApi.set(api, providerId);
  }
}

export function catalogLoaded(): boolean {
  return loaded;
}

function familyProvider(id: string, baseUrl: string): string | null {
  const s = id.toLowerCase();
  if (s.includes("claude")) return "anthropic";
  if (/gpt-|o\d/.test(s)) return "openai";
  if (s.includes("gemini")) return "google";
  if (s.includes("deepseek")) return "deepseek";
  if (s.includes("grok")) return "xai";
  if (s.includes("kimi")) return /moonshot\.cn|kimi\.com/i.test(baseUrl) ? "moonshotai-cn" : "moonshotai";
  if (s.includes("qwen")) return /dashscope.*aliyuncs|aliyuncs.*dashscope/i.test(baseUrl) ? "alibaba-cn" : "alibaba";
  return null;
}

function findIn(providerId: string | null | undefined, keys: string[]): Entry | null {
  if (!providerId) return null;
  const table = byProvider.get(providerId);
  if (!table) return null;
  for (const key of keys) {
    const hit = table.get(key);
    if (hit) return hit;
  }
  return null;
}

function pickEntry(kind: ProviderKind, baseUrl: string, keys: string[]): Entry | null {
  const fromUrl = findIn(byApi.get(endpointKey(baseUrl)), keys);
  if (fromUrl) return fromUrl;
  const official = findIn(OFFICIAL[kind], keys);
  if (official) return official;
  const family = findIn(familyProvider(keys[0] ?? "", baseUrl), keys);
  if (family) return family;
  for (const key of keys) {
    const hits = byModelId.get(key) ?? [];
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

let codexCache: { mtime: number; rows: Map<string, CodexRow> } | null = null;

export function readCodexRows(file = path.join(HOME, ".codex", "models_cache.json")): Map<string, CodexRow> {
  let mtime = -1;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return new Map();
  }
  if (codexCache && codexCache.mtime === mtime) return codexCache.rows;
  const rows = new Map<string, CodexRow>();
  try {
    for (const model of JSON.parse(fs.readFileSync(file, "utf8")).models ?? []) {
      if (typeof model?.slug !== "string" || !(model.context_window > 0)) continue;
      const efforts = Array.isArray(model.supported_reasoning_levels)
        ? model.supported_reasoning_levels.map((level: any) => level?.effort).filter((effort: unknown): effort is string => typeof effort === "string" && !!effort)
        : [];
      rows.set(model.slug, {
        contextWindow: model.context_window,
        vision: Array.isArray(model.input_modalities) && model.input_modalities.includes("image"),
        efforts: sortEfforts(efforts),
        effortDefault: typeof model.default_reasoning_level === "string" ? model.default_reasoning_level : null,
      });
    }
  } catch {}
  codexCache = { mtime, rows };
  return rows;
}

function codexRow(rows: Map<string, CodexRow>, keys: string[]): CodexRow | null {
  for (const key of keys) {
    const hit = rows.get(key);
    if (hit) return hit;
  }
  return null;
}

/**
 * Facts for a model on a particular endpoint.
 * A ChatGPT/Codex subscription slug takes its effort list and context from the local Codex cache;
 * that serving config is not the public API card. Pass `codex` as an empty map to ignore the file.
 */
export function lookupFacts(kind: ProviderKind, baseUrl: string, id: string, codex?: Map<string, CodexRow>): CatalogFacts | null {
  const keys = modelKeys(id);
  const entry = loaded ? pickEntry(kind, baseUrl, keys) : null;
  const row = codexRow(codex ?? readCodexRows(), keys);
  if (!entry && !row) return null;
  const long = /\[1m\]$/i.test(id);
  let contextWindow = row?.contextWindow ?? entry?.contextWindow;
  if (long && contextWindow) contextWindow = Math.max(contextWindow, 1_000_000);
  const efforts = row ? row.efforts : (entry?.efforts ?? []);
  return {
    name: entry?.name,
    contextWindow,
    maxTokens: entry?.maxTokens || undefined,
    vision: row?.vision ?? entry?.vision,
    reasoning: row ? row.efforts.length > 0 : (entry?.reasoning ?? false),
    cost: entry?.cost ?? null,
    efforts,
    effortDefault: row?.effortDefault && efforts.includes(row.effortDefault) ? row.effortDefault : null,
  };
}

function sameCost(a: ModelConfig["cost"], b: NonNullable<CatalogFacts["cost"]>): boolean {
  return a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;
}

function sameEfforts(current: string[] | null | undefined, incoming: string[]): boolean {
  if (current == null) return false;
  return current.length === incoming.length && current.every((value, i) => value === incoming[i]);
}

function zeroCost(cost: ModelConfig["cost"]): boolean {
  return cost.input === 0 && cost.output === 0 && cost.cacheRead === 0 && cost.cacheWrite === 0;
}

/**
 * Fills fields that are still at the generic default. A field that already differs from both the
 * default and the catalog is locked, so a hand edit is not overwritten on the next refresh.
 * Returns null when nothing changes.
 */
export function planBackfill(model: ModelConfig, facts: CatalogFacts | null): ModelConfig | null {
  if (!facts) return null;
  const locked = new Set(model.locked ?? []);
  const next: ModelConfig = { ...model, cost: { ...model.cost }, locked: [...(model.locked ?? [])] };
  let changed = false;
  const take = (field: string, apply: () => void, equal: boolean, isDefault: boolean) => {
    if (locked.has(field) || equal) return;
    if (!isDefault) {
      locked.add(field);
      changed = true;
      return;
    }
    apply();
    changed = true;
  };
  if (facts.contextWindow) {
    take("contextWindow", () => (next.contextWindow = facts.contextWindow!), next.contextWindow === facts.contextWindow, model.contextWindow === CONTEXT_DEFAULT);
  }
  if (facts.maxTokens) {
    take("maxTokens", () => (next.maxTokens = facts.maxTokens!), next.maxTokens === facts.maxTokens, model.maxTokens === MAX_DEFAULT);
  }
  if (facts.cost) {
    take("cost", () => (next.cost = { ...facts.cost! }), sameCost(next.cost, facts.cost), zeroCost(model.cost));
  }
  take("efforts", () => (next.efforts = facts.efforts), sameEfforts(model.efforts, facts.efforts), model.efforts == null);
  if (model.efforts == null && !locked.has("efforts")) {
    const fallback = facts.effortDefault ?? null;
    if ((next.effortDefault ?? null) !== fallback) {
      next.effortDefault = fallback;
      changed = true;
    }
  }
  const untouched =
    model.efforts == null && model.contextWindow === CONTEXT_DEFAULT && model.maxTokens === MAX_DEFAULT && zeroCost(model.cost) && !(model.locked ?? []).length;
  if (untouched && facts.reasoning != null && !locked.has("reasoning") && model.reasoning !== facts.reasoning) {
    next.reasoning = facts.reasoning;
    changed = true;
  }
  if (untouched && facts.vision != null && !locked.has("vision") && model.vision !== facts.vision) {
    next.vision = facts.vision;
    changed = true;
  }
  const lockedList = [...locked];
  if (lockedList.join(",") !== (model.locked ?? []).join(",")) {
    next.locked = lockedList;
    changed = true;
  }
  return changed ? next : null;
}

/** Fields the user changed away from the catalog. A miss (no facts yet) leaves the locks alone. */
export function locksFor(model: ModelConfig, facts: CatalogFacts | null): string[] {
  if (!facts) return [...(model.locked ?? [])];
  const locked: string[] = [];
  if (facts.contextWindow && model.contextWindow !== facts.contextWindow) locked.push("contextWindow");
  if (facts.maxTokens && model.maxTokens !== facts.maxTokens) locked.push("maxTokens");
  if (facts.cost && !sameCost(model.cost, facts.cost)) locked.push("cost");
  if (facts.reasoning != null && model.reasoning !== facts.reasoning) locked.push("reasoning");
  if (facts.vision != null && model.vision !== facts.vision) locked.push("vision");
  // Null means the list was never set, not that the user cleared it.
  if (model.efforts != null && !sameEfforts(model.efforts, facts.efforts)) locked.push("efforts");
  return locked;
}

export function catalogPath(dataDir: string): string {
  return path.join(dataDir, "models-dev.json");
}

export function loadCatalogCache(dataDir: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(dataDir), "utf8"));
    installCatalog(parsed?.catalog ?? parsed);
    return true;
  } catch {
    return false;
  }
}

export async function refreshCatalog(dataDir: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const file = catalogPath(dataDir);
  let fetchedAt = 0;
  try {
    fetchedAt = JSON.parse(fs.readFileSync(file, "utf8")).fetchedAt ?? 0;
  } catch {}
  if (loaded && fetchedAt && Date.now() - fetchedAt < MAX_AGE_MS) return false;
  try {
    const res = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();
    installCatalog(catalog);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), catalog }));
    return true;
  } catch {
    if (!loaded) loadCatalogCache(dataDir);
    return false;
  }
}
