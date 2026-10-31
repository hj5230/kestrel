// Model providers and their models, including the catalog backfill for models saved before it existed.
import type { ModelConfig, ProviderConfig } from "../../shared/protocol";
import { planBackfill, type CatalogFacts } from "../catalog";
import { db, json } from "./connection";

export const rowToProvider = (r: any): ProviderConfig => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  baseUrl: r.base_url,
  apiKey: r.api_key,
  headers: json(r.headers, {}),
  enabled: !!r.enabled,
  createdAt: r.created_at,
});

export function listProviders(): ProviderConfig[] {
  return db.query("SELECT * FROM providers ORDER BY created_at").all().map(rowToProvider);
}

export function getProvider(id: string): ProviderConfig | null {
  const r = db.query("SELECT * FROM providers WHERE id = ?").get(id);
  return r ? rowToProvider(r) : null;
}

export function upsertProvider(p: ProviderConfig) {
  // Older paired clients can still submit the previous provider type.
  const legacy = (p.kind as string) === "kiro";
  const kind = legacy ? "amazon-q" : p.kind;
  const name = legacy && p.name === "Kiro" ? "Amazon Q" : p.name;
  db.run(
    `INSERT INTO providers (id, kind, name, base_url, api_key, headers, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, base_url = excluded.base_url,
       api_key = excluded.api_key, headers = excluded.headers, enabled = excluded.enabled`,
    [p.id, kind, name, p.baseUrl, p.apiKey, JSON.stringify(p.headers ?? {}), p.enabled ? 1 : 0, p.createdAt || Date.now()],
  );
}

export function deleteProvider(id: string) {
  db.run("DELETE FROM providers WHERE id = ?", [id]);
}

export const rowToModel = (r: any): ModelConfig => ({
  providerId: r.provider_id,
  id: r.id,
  name: r.name,
  contextWindow: r.context_window,
  maxTokens: r.max_tokens,
  reasoning: !!r.reasoning,
  vision: !!r.vision,
  cost: { input: r.cost_input, output: r.cost_output, cacheRead: r.cost_cache_read, cacheWrite: r.cost_cache_write },
  enabled: !!r.enabled,
  efforts: r.efforts == null || r.efforts === "" ? null : json<string[]>(r.efforts, []),
  effortDefault: r.effort_default ?? null,
  locked: r.locked ? String(r.locked).split(",").filter(Boolean) : [],
  metadataSource: r.metadata_source === "codex" ? "codex" : "catalog",
  metadata: r.metadata ? json(r.metadata, undefined) : undefined,
});

export function listModels(providerId?: string): ModelConfig[] {
  const rows = providerId
    ? db.query("SELECT * FROM models WHERE provider_id = ? ORDER BY sort, id").all(providerId)
    : db.query("SELECT m.* FROM models m JOIN providers p ON p.id = m.provider_id ORDER BY p.created_at, m.sort, m.id").all();
  return rows.map(rowToModel);
}

export function getModel(providerId: string, id: string): ModelConfig | null {
  const r = db.query("SELECT * FROM models WHERE provider_id = ? AND id = ?").get(providerId, id);
  return r ? rowToModel(r) : null;
}

export function upsertModel(m: ModelConfig) {
  db.run(
    `INSERT INTO models (provider_id, id, name, context_window, max_tokens, reasoning, vision, cost_input, cost_output, cost_cache_read, cost_cache_write, enabled, efforts, effort_default, locked, metadata_source, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, id) DO UPDATE SET name = excluded.name, context_window = excluded.context_window,
       max_tokens = excluded.max_tokens, reasoning = excluded.reasoning, vision = excluded.vision,
       cost_input = excluded.cost_input, cost_output = excluded.cost_output, cost_cache_read = excluded.cost_cache_read,
       cost_cache_write = excluded.cost_cache_write, enabled = excluded.enabled, efforts = excluded.efforts,
       effort_default = excluded.effort_default, locked = excluded.locked,
       metadata_source = excluded.metadata_source, metadata = excluded.metadata`,
    [
      m.providerId,
      m.id,
      m.name,
      m.contextWindow,
      m.maxTokens,
      m.reasoning ? 1 : 0,
      m.vision ? 1 : 0,
      m.cost.input,
      m.cost.output,
      m.cost.cacheRead,
      m.cost.cacheWrite,
      m.enabled ? 1 : 0,
      m.efforts == null ? null : JSON.stringify(m.efforts),
      m.effortDefault ?? null,
      (m.locked ?? []).join(","),
      m.metadataSource ?? "catalog",
      m.metadata ? JSON.stringify(m.metadata) : null,
    ],
  );
}

/** Fills catalog fields that are still at the generic default. Returns how many rows changed. */
export function backfillModels(factsFor: (m: ModelConfig) => CatalogFacts | null): number {
  let changed = 0;
  for (const model of listModels()) {
    const next = planBackfill(model, factsFor(model));
    if (!next) continue;
    upsertModel(next);
    changed++;
  }
  return changed;
}

export function deleteModel(providerId: string, id: string) {
  db.run("DELETE FROM models WHERE provider_id = ? AND id = ?", [providerId, id]);
}
