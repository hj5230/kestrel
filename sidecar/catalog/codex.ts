// Models the Codex CLI knows (its models cache), for providers that route to OpenAI's Codex endpoint.
import fs from "node:fs";
import path from "node:path";
import { sortEfforts } from "../../shared/effort";
import { HOME } from "../env";

export interface CodexRow {
  contextWindow: number;
  vision: boolean;
  efforts: string[];
  effortDefault: string | null;
}

export let codexCache: { mtime: number; rows: Map<string, CodexRow> } | null = null;

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

export function codexRow(rows: Map<string, CodexRow>, keys: string[]): CodexRow | null {
  for (const key of keys) {
    const hit = rows.get(key);
    if (hit) return hit;
  }
  return null;
}
