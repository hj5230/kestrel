// A search index over conversations other apps keep on this Mac (Claude Code, Codex, Cursor).
// It lives in its own database next to Kestrel's, holds only what the transcripts say, and can be
// deleted at any time: it is rebuilt from the originals. Files are read incrementally, so after the
// first pass only what was appended since is parsed.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import { collapseHome } from "../env";
import type { HistoryStatus } from "../../shared/protocol";
import { SOURCES, T_FIRST, type HistoryEvent, type HistorySource, type HistorySourceId } from "./sources";
import { logger } from "../log";

const log = logger("history");
export { searchHistory, isHistoryKey, readHistory, type HistoryHit } from "./search";

const VERSION = 1;
const MAX_TEXT = 20_000; // per message; pasted logs beyond this are not worth indexing
const CHUNK = 4 * 1024 * 1024;

export let db: Database | null = null;
export let enabled: HistorySourceId[] = [];
let syncing: Promise<void> | null = null;
let lastSync = 0;
let progress = { done: 0, total: 0 };

/** `file` is a path, or ":memory:". */
export function openHistoryDb(file: string) {
  db?.close();
  db = new Database(file, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  const v = (db.query("PRAGMA user_version").get() as any).user_version as number;
  if (v !== VERSION) {
    for (const t of ["files", "sessions", "msgs"]) db.run(`DROP TABLE IF EXISTS ${t}`);
    db.run(`CREATE TABLE files (path TEXT PRIMARY KEY, source TEXT NOT NULL, key TEXT, size INTEGER NOT NULL, offset INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0, ignored INTEGER NOT NULL DEFAULT 0)`);
    db.run(`CREATE TABLE sessions (key TEXT PRIMARY KEY, source TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', title_rank INTEGER NOT NULL DEFAULT 0, cwd TEXT NOT NULL DEFAULT '', started_at INTEGER, updated_at INTEGER NOT NULL, messages INTEGER NOT NULL DEFAULT 0)`);
    db.run(`CREATE INDEX sessions_source ON sessions(source)`);
    db.run(`CREATE VIRTUAL TABLE msgs USING fts5(text, key UNINDEXED, seq UNINDEXED, role UNINDEXED, tokenize = 'trigram')`);
    db.run(`PRAGMA user_version = ${VERSION}`);
  }
  lastSync = 0;
  syncing = null;
}

/** Which apps are searched. Turning one off deletes what was indexed from it. */
export function setHistorySources(ids: string[]) {
  const next = SOURCES.filter((s) => ids.includes(s.id)).map((s) => s.id);
  if (next.join() !== enabled.join()) lastSync = 0; // the index no longer matches what is wanted
  enabled = next;
}

export const D = () => {
  if (!db) throw new Error("history index is not open");
  return db;
};

function purge(source: string) {
  const d = D();
  d.transaction(() => {
    d.run("DELETE FROM msgs WHERE key IN (SELECT key FROM sessions WHERE source = ?)", [source]);
    d.run("DELETE FROM sessions WHERE source = ?", [source]);
    d.run("DELETE FROM files WHERE source = ?", [source]);
  })();
}

function dropFile(file: string) {
  const d = D();
  const row = d.query("SELECT key FROM files WHERE path = ?").get(file) as { key: string | null } | null;
  if (row?.key) {
    d.run("DELETE FROM msgs WHERE key = ?", [row.key]);
    d.run("DELETE FROM sessions WHERE key = ?", [row.key]);
  }
  d.run("DELETE FROM files WHERE path = ?", [file]);
}

/** Whole lines of `file` from `from` on, in pieces; stops before an unfinished last line. */
export function* lines(file: string, from: number, size: number): Generator<{ line: string; end: number }> {
  const fd = fs.openSync(file, "r");
  try {
    let pos = from;
    let carry = Buffer.alloc(0);
    const buf = Buffer.allocUnsafe(CHUNK);
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      pos += n;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const base = pos - data.length;
      let start = 0;
      for (let nl = data.indexOf(10, start); nl >= 0; nl = data.indexOf(10, start)) {
        yield { line: data.toString("utf8", start, nl), end: base + nl + 1 };
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
  } finally {
    fs.closeSync(fd);
  }
}

function indexFile(src: HistorySource, file: string, stat: fs.Stats) {
  const d = D();
  const prev = d.query("SELECT key, size, offset, seq, ignored FROM files WHERE path = ?").get(file) as { key: string | null; size: number; offset: number; seq: number; ignored: number } | null;
  if (prev && prev.size === stat.size && prev.offset <= stat.size) return;
  if (prev && stat.size < prev.size) dropFile(file); // rewritten: start over
  const row = stat.size < (prev?.size ?? 0) ? null : prev;

  let key = row?.key ?? null;
  let offset = row?.offset ?? 0;
  let seq = row?.seq ?? 0;
  let ignored = row?.ignored ?? 0;
  if (ignored) {
    d.run("UPDATE files SET size = ?, offset = ? WHERE path = ?", [stat.size, stat.size, file]);
    return;
  }
  const sess = key ? (d.query("SELECT title, title_rank, cwd, started_at, updated_at FROM sessions WHERE key = ?").get(key) as any) : null;
  let title: string = sess?.title ?? "";
  let rank: number = sess?.title_rank ?? 0;
  let cwd: string = sess?.cwd ?? "";
  let started: number | null = sess?.started_at ?? null;
  let updated: number = sess?.updated_at ?? 0;
  const id = src.idOf(file);
  const pending: { role: string; text: string; seq: number }[] = [];
  let tsSeen = false;

  const apply = (e: HistoryEvent) => {
    if (e.t === "skip") ignored = 1;
    else if (e.t === "meta") {
      if (e.cwd && !cwd) cwd = e.cwd;
      if (e.startedAt && (!started || e.startedAt < started)) started = e.startedAt;
      if (e.title && (e.rank ?? 0) >= rank) {
        title = e.title;
        rank = e.rank ?? 0;
      }
    } else if (e.t === "msg") {
      const text = e.text.length > MAX_TEXT ? e.text.slice(0, MAX_TEXT) : e.text;
      pending.push({ role: e.role, text, seq: seq++ });
      if (e.ts) {
        tsSeen = true;
        if (e.ts > updated) updated = e.ts;
      }
      if (e.role === "user" && rank < T_FIRST) {
        title = e.text.replace(/\s+/g, " ").trim().slice(0, 80);
        rank = T_FIRST;
      }
    }
  };

  let consumed = offset;
  for (const { line, end } of lines(file, offset, stat.size)) {
    consumed = end;
    if (!line || !src.wants(line)) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const e of src.parse(o, false)) apply(e);
    if (ignored) break;
  }
  if (ignored) {
    dropFile(file);
    d.run("INSERT INTO files (path, source, key, size, offset, ignored) VALUES (?, ?, NULL, ?, ?, 1)", [file, src.id, stat.size, stat.size]);
    return;
  }

  // apps that do not timestamp messages: the file's own time
  if (!tsSeen && pending.length) updated = Math.max(updated, Math.floor(stat.mtimeMs));
  d.transaction(() => {
    if (!key && (pending.length || title)) key = `${src.id}:${id}`;
    if (key) {
      // a fork or copy can carry the same id; the later file replaces the earlier one
      const existing = d.query("SELECT path FROM sessions WHERE key = ?").get(key) as { path: string } | null;
      if (existing && existing.path !== file) dropFile(existing.path);
      const insert = d.prepare("INSERT INTO msgs (text, key, seq, role) VALUES (?, ?, ?, ?)");
      for (const m of pending) insert.run(m.text, key, m.seq, m.role);
      d.run(
        `INSERT INTO sessions (key, source, id, path, title, title_rank, cwd, started_at, updated_at, messages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET path = excluded.path, title = excluded.title, title_rank = excluded.title_rank, cwd = excluded.cwd,
           started_at = excluded.started_at, updated_at = excluded.updated_at, messages = excluded.messages`,
        [key, src.id, id, file, title, rank, cwd, started, updated || Math.floor(stat.mtimeMs), seq],
      );
    }
    d.run(
      `INSERT INTO files (path, source, key, size, offset, seq, ignored) VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(path) DO UPDATE SET key = excluded.key, size = excluded.size, offset = excluded.offset, seq = excluded.seq, ignored = 0`,
      [file, src.id, key, stat.size, consumed, seq],
    );
  })();
}

async function runSync() {
  const d = D();
  for (const s of SOURCES) if (!enabled.includes(s.id) && d.query("SELECT 1 FROM files WHERE source = ? LIMIT 1").get(s.id)) purge(s.id);

  const work: { src: HistorySource; file: string; stat: fs.Stats }[] = [];
  for (const src of SOURCES) {
    if (!enabled.includes(src.id)) continue;
    const seen = new Set<string>();
    for (const file of src.files()) {
      try {
        work.push({ src, file, stat: fs.statSync(file) });
        seen.add(file);
      } catch {}
    }
    for (const r of d.query("SELECT path FROM files WHERE source = ?").all(src.id) as { path: string }[]) if (!seen.has(r.path)) dropFile(r.path);
  }
  progress = { done: 0, total: work.length };
  const syncStart = Date.now();
  log.debug("history sync started", { files: work.length, sources: enabled });
  let last = Date.now();
  for (const w of work) {
    try {
      indexFile(w.src, w.file, w.stat);
    } catch (e) {
      // an unreadable or half-written file is retried on the next pass
      log.debug("history file skipped", { source: w.src.id, file: w.file, error: e });
    }
    progress.done++;
    if (Date.now() - last > 50) {
      await Bun.sleep(0); // let searches and the agent run in between
      last = Date.now();
    }
  }
  // names kept outside the transcripts
  for (const src of SOURCES) {
    if (!enabled.includes(src.id) || !src.titles) continue;
    for (const [id, name] of src.titles()) d.run("UPDATE sessions SET title = ?, title_rank = 2 WHERE key = ? AND title_rank <= 2", [name, `${src.id}:${id}`]);
  }
  lastSync = Date.now();
  log.info("history sync finished", { files: work.length, ms: Date.now() - syncStart });
}

/** Brings the index up to date. One pass at a time; callers share it. */
export function syncHistory(): Promise<void> {
  if (!db) return Promise.resolve();
  syncing ??= runSync().finally(() => (syncing = null));
  return syncing;
}

/** Waits for a pass that is already running, or starts one if the index is stale. Gives up after `ms`. */
export async function freshHistory(ms = 15_000, maxAge = 20_000): Promise<{ complete: boolean }> {
  if (!db || !enabled.length) return { complete: true };
  if (!syncing && Date.now() - lastSync < maxAge) return { complete: true };
  const pass = syncHistory();
  const done = await Promise.race([pass.then(() => true), Bun.sleep(ms).then(() => false)]);
  return { complete: done };
}

export function historyStatus(): HistoryStatus {
  const rows = db ? (D().query("SELECT source, COUNT(*) n, COALESCE(SUM(messages), 0) m FROM sessions GROUP BY source").all() as any[]) : [];
  return {
    sources: SOURCES.map((s) => {
      const r = rows.find((x) => x.source === s.id);
      return { id: s.id, label: s.label, root: collapseHome(s.root()), found: fs.existsSync(s.root()), enabled: enabled.includes(s.id), sessions: r?.n ?? 0, messages: r?.m ?? 0 };
    }),
    indexing: !!syncing,
    progress,
  };
}

/** Throws the index away and reads everything again. */
export function rebuildHistory(): Promise<void> {
  if (!db) return Promise.resolve();
  log.info("history rebuild requested");
  for (const s of SOURCES) purge(s.id);
  return syncHistory();
}
