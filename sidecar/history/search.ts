// Searching the history index and reading one indexed conversation back from its original file.
import fs from "node:fs";
import { collapseHome } from "../env";
import { sourceById, type HistorySourceId } from "./sources";
import { db, enabled, D, lines } from "./index";

export interface HistoryHit {
  key: string;
  source: HistorySourceId;
  title: string;
  cwd: string;
  updatedAt: number;
  matches: { role: string; seq: number; snippet: string }[];
}

export function searchHistory(query: string, opts: { limit?: number; source?: string; project?: string } = {}): HistoryHit[] {
  const q = query.trim();
  if (!db || !q || !enabled.length) return [];
  const d = D();
  const limit = opts.limit ?? 20;
  const sources = (opts.source && opts.source !== "all" ? [opts.source] : enabled).filter((s) => enabled.includes(s as HistorySourceId));
  if (!sources.length) return [];
  const where = [`s.source IN (${sources.map(() => "?").join(",")})`];
  const args: any[] = [...sources];
  if (opts.project) {
    where.push("s.cwd LIKE ?");
    args.push(`%${opts.project}%`);
  }

  let rows: any[];
  if ([...q].length >= 3) {
    const terms = q.split(/\s+/).filter((t) => [...t].length >= 3);
    const match = terms.length ? terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ") : `"${q.replace(/"/g, '""')}"`;
    rows = d
      .query(
        `SELECT f.key key, CAST(f.seq AS INTEGER) seq, f.role role, snippet(msgs, 0, '«', '»', '…', 24) snippet
         FROM msgs f JOIN sessions s ON s.key = f.key
         WHERE msgs MATCH ? AND ${where.join(" AND ")} ORDER BY s.updated_at DESC, f.seq LIMIT ?`,
      )
      .all(match, ...args, limit * 8);
  } else {
    rows = d
      .query(
        `SELECT f.key key, CAST(f.seq AS INTEGER) seq, f.role role, substr(f.text, max(1, instr(f.text, ?) - 40), 120) snippet
         FROM msgs f JOIN sessions s ON s.key = f.key
         WHERE f.text LIKE ? AND ${where.join(" AND ")} ORDER BY s.updated_at DESC, f.seq LIMIT ?`,
      )
      .all(q, `%${q}%`, ...args, limit * 8);
  }

  const hits = new Map<string, HistoryHit>();
  const info = (key: string) => d.query("SELECT source, title, cwd, updated_at updatedAt FROM sessions WHERE key = ?").get(key) as any;
  for (const r of rows) {
    const h: HistoryHit | undefined = hits.get(r.key) ?? (hits.size < limit ? { key: r.key, ...info(r.key), matches: [] } : undefined);
    if (!h) continue;
    hits.set(r.key, h);
    if (h.matches.length < 2) h.matches.push({ role: r.role, seq: r.seq, snippet: r.snippet.replace(/\s+/g, " ") });
  }
  // sessions whose title matches but whose messages do not
  for (const t of d
    .query(`SELECT s.key key, s.source source, s.title title, s.cwd cwd, s.updated_at updatedAt FROM sessions s WHERE s.title LIKE ? AND ${where.join(" AND ")} ORDER BY s.updated_at DESC LIMIT 10`)
    .all(`%${q}%`, ...args) as any[]) {
    if (!hits.has(t.key) && hits.size < limit) hits.set(t.key, { ...t, matches: [{ role: "title", seq: -1, snippet: t.title }] });
  }
  return [...hits.values()];
}

export function isHistoryKey(id: string): boolean {
  const i = id.indexOf(":");
  return i > 0 && !!sourceById(id.slice(0, i));
}

export const ts = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "unknown");

/** A session from another app as a readable transcript, parsed from the original file. */
export function readHistory(key: string, fromSeq = 0, maxChars = 30_000): string {
  const d = D();
  const s = d.query("SELECT source, path, title, cwd, started_at, updated_at, messages FROM sessions WHERE key = ?").get(key) as any;
  if (!s || !enabled.includes(s.source)) throw new Error(`Session ${key} not found`);
  const src = sourceById(s.source)!;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(s.path);
  } catch {
    throw new Error(`The file behind session ${key} no longer exists`);
  }
  const parts: string[] = [];
  let seq = 0;
  for (const { line } of lines(s.path, 0, stat.size)) {
    if (!line || !src.wants(line)) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const e of src.parse(o, true)) {
      if (e.t === "msg") {
        if (seq >= fromSeq) parts.push(`## ${e.role === "user" ? "User" : "Assistant"} #${seq}\n${e.text}`);
        seq++;
      } else if (e.t === "tool" && seq > fromSeq) parts.push(e.text);
    }
  }
  const header =
    `# ${s.title || "untitled"}\napp: ${src.label}\ncwd: ${s.cwd ? collapseHome(s.cwd) : "unknown"}\nstarted: ${ts(s.started_at)}\nupdated: ${ts(s.updated_at)}\n` +
    `messages: ${seq}${fromSeq ? ` (from #${fromSeq})` : ""}\n\n`;
  let body = parts.join("\n\n");
  if (body.length > maxChars) body = body.slice(0, maxChars) + `\n\n[Truncated; continue with from_seq to read more]`;
  return header + body;
}
