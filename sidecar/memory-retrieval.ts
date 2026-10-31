// Shared retrieval for automatic context and memory_search. Both model calls are mandatory, including on an empty store.
// SQLite only caches vectors: Markdown remains authoritative and content hashes prevent serving stale entries.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { AppSettings, MemoryEntry, MemoryStatus } from "../shared/protocol";
import { allMemories, hashMemory, memoryDir, memorySnapshot, migrateMemories } from "./memory";
import { memoryConfigured } from "./memory-config";
import { st } from "./i18n";
import { SharedMemoryWork } from "./memory-work";
import { embedTexts, rerankTexts, memoryChunks, embedChunks, memoryDocument } from "./memory/models";
export { embedTexts, rerankTexts, memoryChunks, memoryDocument } from "./memory/models";
export { discloseMemory } from "./memory/disclose";

let index: Database | null = null;
let root = "";
const work = new SharedMemoryWork();
let error: string | null = null;
let migrated = 0;
let verified = "";
let verifiedAt = 0;
let generation = 0;

function cache(): Database {
  const next = memoryDir();
  if (index && root === next) return index;
  cancelMemoryWork();
  index?.close();
  index = null;
  root = next;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, ".index-v2.sqlite");
  index = new Database(file);
  fs.chmodSync(file, 0o600);
  index.run("PRAGMA journal_mode = WAL");
  index.run("CREATE TABLE IF NOT EXISTS vectors (id TEXT NOT NULL, revision TEXT NOT NULL, model TEXT NOT NULL, vector BLOB NOT NULL, dimension INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(id, model))");
  if (!(index.query("PRAGMA table_info(vectors)").all() as { name: string }[]).some((c) => c.name === "dimension")) index.run("ALTER TABLE vectors ADD COLUMN dimension INTEGER NOT NULL DEFAULT 0");
  error = null;
  migrated = 0;
  verified = "";
  verifiedAt = 0;
  return index;
}

export function initializeMemory() {
  cache();
  migrated += migrateMemories();
}

export const embeddingKey = (s: AppSettings) => hashMemory(JSON.stringify(["chunks900-float32-v1", s.memoryEmbedding.api, s.memoryEmbedding.url, s.memoryEmbedding.model]));
export const memoryConfigKey = (s: AppSettings) => hashMemory(JSON.stringify([s.memoryEnabled, s.memoryEmbedding, s.memoryReranker, s.memoryMinScore]));
const preparationKey = (s: AppSettings) => `prepare:${memoryDir()}:${memoryConfigKey(s)}`;

export function cancelMemoryWork() {
  generation++;
  work.cancel();
  verified = "";
  verifiedAt = 0;
  error = null;
}

export function assertMemoryConfigured(s: AppSettings) {
  if (!s.memoryEnabled) throw new Error(st("memoryDisabled"));
  if (!memoryConfigured(s)) throw new Error(st("memoryUnconfigured"));
}

export async function indexMemories(s: AppSettings, signal?: AbortSignal) {
  assertMemoryConfigured(s);
  initializeMemory();
  return work.run(`index:${memoryDir()}:${embeddingKey(s)}`, async (sharedSignal) => {
    try {
      const db = cache();
      const key = embeddingKey(s);
      const all = allMemories();
      const rows = db.query("SELECT id, revision FROM vectors WHERE model = ?").all(key) as { id: string; revision: string }[];
      const known = new Map(rows.map((r) => [r.id, r.revision]));
      const missing = all.filter((m) => known.get(m.id) !== m.revision);
      for (let start = 0; start < missing.length; start += 16) {
        const batch = missing.slice(start, start + 16);
        const chunks = batch.map((m) => memoryChunks(memoryDocument(m)));
        const vectors = await embedChunks(s, chunks.flat(), sharedSignal);
        sharedSignal.throwIfAborted();
        let offset = 0;
        const packed = chunks.map((parts) => {
          const values = vectors.slice(offset, offset + parts.length).flat();
          offset += parts.length;
          return new Uint8Array(new Float32Array(values).buffer);
        });
        // A manual edit while embedding was in flight is left for the next sync, never attached to the old revision.
        const current = new Map(allMemories().map((m) => [m.id, m.revision]));
        db.transaction(() => batch.forEach((m, i) => {
          if (current.get(m.id) === m.revision) db.run("INSERT OR REPLACE INTO vectors (id, revision, model, vector, dimension) VALUES (?, ?, ?, ?, ?)", [m.id, m.revision, key, packed[i], vectors[0].length]);
        }))();
      }
      const live = new Set(allMemories().map((m) => m.id));
      for (const row of db.query("SELECT DISTINCT id FROM vectors").all() as { id: string }[]) if (!live.has(row.id)) db.run("DELETE FROM vectors WHERE id = ?", [row.id]);
    } catch (e) { if (!sharedSignal.aborted) error = e instanceof Error ? e.message : String(e); throw e; }
  }, signal);
}

export async function testMemoryModels(s: AppSettings, signal?: AbortSignal) {
  assertMemoryConfigured(s);
  await embedTexts(s, ["Memory connection test"], signal);
  await rerankTexts(s, "Memory connection test", ["Saved personal context", "Unrelated example"], signal);
}

/** Warmup is shared with foreground reads; stopping a conversation must not kill the model's cold load. */
export async function prepareMemory(s: AppSettings, signal?: AbortSignal) {
  assertMemoryConfigured(s);
  initializeMemory();
  return work.run(preparationKey(s), async (sharedSignal) => {
    error = null;
    try {
      await testMemoryModels(s, sharedSignal);
      await indexMemories(s, sharedSignal);
      sharedSignal.throwIfAborted();
      verified = memoryConfigKey(s);
      verifiedAt = Date.now();
      error = null;
    } catch (e) { if (!sharedSignal.aborted) error = e instanceof Error ? e.message : String(e); throw e; }
  }, signal);
}

export function memoryStatus(s: AppSettings): MemoryStatus {
  try { return readStatus(s); }
  catch (e) { return { state: "error", total: 0, indexed: 0, error: e instanceof Error ? e.message : String(e), pending: 0, failed: 0, saveError: null, migrated }; }
}

function readStatus(s: AppSettings): MemoryStatus {
  initializeMemory();
  const notes = allMemories();
  const rows = cache().query("SELECT id, revision FROM vectors WHERE model = ?").all(embeddingKey(s)) as { id: string; revision: string }[];
  const known = new Map(rows.map((r) => [r.id, r.revision]));
  const indexed = notes.filter((n) => known.get(n.id) === n.revision).length;
  const state = !s.memoryEnabled ? "disabled" : !memoryConfigured(s) ? "unconfigured" : work.active ? "indexing" : error ? "error" : indexed === notes.length && verified === memoryConfigKey(s) ? "ready" : "indexing";
  return { state, total: notes.length, indexed, error, pending: 0, failed: 0, saveError: null, migrated };
}

function words(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens = normalized.match(/[a-z0-9_-]+|[\p{Script=Han}]+/gu) ?? [];
  return [...new Set(tokens.flatMap((t) => /\p{Script=Han}/u.test(t) && t.length > 2 ? [...t].slice(1).map((_, i) => t.slice(i, i + 2)) : [t]))];
}

export interface MemoryHit { note: MemoryEntry; score: number }
export interface MemoryRecall { hits: MemoryHit[]; topics: { topic: string; count: number }[]; snapshot: string }

class MemoryChangedError extends Error {}

export async function recallMemory(s: AppSettings, query: string, opts: { topic?: string; limit?: number; signal?: AbortSignal } = {}): Promise<MemoryRecall> {
  // Background saves can finish during retrieval. Re-run the same complete pipeline on a fresh snapshot.
  for (let attempt = 0; ; attempt++) {
    try { return await recallOnce(s, query, opts); }
    catch (e) { if (!(e instanceof MemoryChangedError) || attempt >= 2 || opts.signal?.aborted) throw e; }
  }
}

async function recallOnce(s: AppSettings, query: string, opts: { topic?: string; limit?: number; signal?: AbortSignal }): Promise<MemoryRecall> {
  assertMemoryConfigured(s);
  initializeMemory();
  const startedGeneration = generation;
  try {
    await work.wait(preparationKey(s), opts.signal);
    await indexMemories(s, opts.signal);
    const snapshot = memorySnapshot();
    const all = allMemories();
    const notes = all.filter((m) => !opts.topic || m.topic === opts.topic);
    const queries = await embedChunks(s, memoryChunks(query || opts.topic || "Saved personal context"), opts.signal);
    const dim = queries[0].length;
    const vectors = new Map((cache().query("SELECT id, revision, vector, dimension FROM vectors WHERE model = ?").all(embeddingKey(s)) as { id: string; revision: string; vector: Uint8Array; dimension: number }[]).map((r) => [r.id, r]));
    const terms = words(query);
    const dense = notes.map((m) => {
      const row = vectors.get(m.id);
      if (!row || row.revision !== m.revision) throw new MemoryChangedError("Memory changed during indexing. Retry the request.");
      if (!(row.vector instanceof Uint8Array) || row.vector.byteLength % 4) throw new Error("Memory vector cache is invalid. Rebuild the index.");
      const vector = new Float32Array(Uint8Array.from(row.vector).buffer);
      if (row.dimension !== dim || !vector.length || vector.length % dim || vector.some((n) => !Number.isFinite(n)) || !vector.some((n) => n !== 0)) throw new Error("Embedding dimensions or cached values changed. Rebuild the memory index.");
      let score = -Infinity;
      for (let offset = 0; offset < vector.length; offset += dim) for (const q of queries) {
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += vector[offset + i] * q[i];
        score = Math.max(score, dot);
      }
      return { m, score };
    }).sort((a, b) => b.score - a.score);
    const lexical = notes.map((m) => {
      const body = memoryDocument(m).normalize("NFKC").toLowerCase();
      return { m, score: terms.reduce((sum, t) => sum + (body.includes(t) ? 1 : 0), 0) + m.aliases.filter((a) => query.toLowerCase().includes(a.toLowerCase())).length * 5 };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
    const fused = new Map<string, { note: MemoryEntry; score: number }>();
    for (const ranking of [dense, lexical]) ranking.slice(0, 40).forEach(({ m }, i) => {
      const row = fused.get(m.id) ?? { note: m, score: 0 };
      row.score += 1 / (60 + i + 1);
      fused.set(m.id, row);
    });
    const candidates = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, 40).map((r) => r.note);
    const ranked = await rerankTexts(s, query || opts.topic || "Saved personal context", candidates.length ? candidates.map(memoryDocument) : ["No saved notes."], opts.signal);
    if (memorySnapshot() !== snapshot) throw new MemoryChangedError("Memory changed during retrieval. Retry the request.");
    const counts = new Map<string, number>();
    all.forEach((m) => counts.set(m.topic, (counts.get(m.topic) ?? 0) + 1));
    error = null;
    verified = memoryConfigKey(s);
    verifiedAt = Date.now();
    return { hits: candidates.length ? ranked.slice(0, opts.limit ?? 15).map((r) => ({ note: candidates[r.index], score: r.score })) : [], topics: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([topic, count]) => ({ topic, count })), snapshot };
  } catch (e) { if (generation === startedGeneration && !opts.signal?.aborted) error = e instanceof Error ? e.message : String(e); throw e; }
}

/** Direct read/write tools also require healthy endpoints; success is cached briefly within a turn. */
export async function requireMemory(s: AppSettings, signal?: AbortSignal) {
  assertMemoryConfigured(s);
  if (verified !== memoryConfigKey(s) || Date.now() - verifiedAt > 30000 || error) await prepareMemory(s, signal);
}

export function resetMemoryIndex() {
  cache().run("DELETE FROM vectors");
  verified = "";
  verifiedAt = 0;
  error = null;
}
