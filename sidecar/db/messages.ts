// A session's messages and compactions, and the full-text index that search runs on.
import type { ChatMessage, CompactionInfo, SearchHit, StoredMessage } from "../../shared/protocol";
import { db } from "./connection";

export function searchableText(m: ChatMessage): string {
  if (m.role === "user") {
    return typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  }
  if (m.role === "assistant") {
    return m.content
      .map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? `${c.name} ${JSON.stringify(c.arguments).slice(0, 400)}` : ""))
      .join("\n");
  }
  return "";
}

export function loadMessages(sessionId: string): StoredMessage[] {
  return (db.query("SELECT seq, data FROM messages WHERE session_id = ? ORDER BY seq").all(sessionId) as any[]).map((r) => ({
    seq: r.seq,
    message: JSON.parse(r.data),
  }));
}

export function appendMessage(sessionId: string, message: ChatMessage, memoryEpoch?: string): StoredMessage {
  const row = db.query("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE session_id = ?").get(sessionId) as { next: number };
  const seq = row.next;
  db.transaction(() => {
    db.run("INSERT INTO messages (session_id, seq, role, data, created_at) VALUES (?, ?, ?, ?, ?)", [
      sessionId,
      seq,
      message.role,
      JSON.stringify(message),
      Date.now(),
    ]);
    const text = searchableText(message).trim();
    if (text) db.run("INSERT INTO messages_fts (text, session_id, seq, role) VALUES (?, ?, ?, ?)", [text, sessionId, seq, message.role]);
    db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [Date.now(), sessionId]);
    if (message.role === "user" && memoryEpoch !== undefined) {
      db.run("INSERT INTO memory_jobs (id, session_id, seq, message, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?)", [crypto.randomUUID(), sessionId, seq, JSON.stringify(message), memoryEpoch, Date.now()]);
    }
  })();
  return { seq, message };
}

export function truncateMessages(sessionId: string, fromSeq: number) {
  db.transaction(() => {
    db.run("DELETE FROM memory_jobs WHERE session_id = ? AND seq >= ?", [sessionId, fromSeq]);
    db.run("DELETE FROM messages WHERE session_id = ? AND seq >= ?", [sessionId, fromSeq]);
    db.run("DELETE FROM messages_fts WHERE session_id = ? AND seq >= ?", [sessionId, fromSeq]);
    db.run("DELETE FROM compactions WHERE session_id = ? AND cut_seq >= ?", [sessionId, fromSeq]);
  })();
}

export function copyMessages(fromSession: string, toSession: string, uptoSeq: number) {
  db.transaction(() => {
    db.run(
      `INSERT INTO messages (session_id, seq, role, data, created_at)
       SELECT ?, seq, role, data, created_at FROM messages WHERE session_id = ? AND seq <= ?`,
      [toSession, fromSession, uptoSeq],
    );
    db.run(
      `INSERT INTO messages_fts (text, session_id, seq, role)
       SELECT text, ?, seq, role FROM messages_fts WHERE session_id = ? AND CAST(seq AS INTEGER) <= ?`,
      [toSession, fromSession, uptoSeq],
    );
    db.run(
      `INSERT INTO compactions (session_id, cut_seq, summary, tokens_before, auto, created_at)
       SELECT ?, cut_seq, summary, tokens_before, auto, created_at FROM compactions WHERE session_id = ? AND cut_seq <= ?`,
      [toSession, fromSession, uptoSeq],
    );
  })();
}

export function rewriteSessionPathPrefix(sessionId: string, fromPrefix: string, toPrefix: string) {
  db.transaction(() => {
    db.run("UPDATE messages SET data = REPLACE(data, ?, ?) WHERE session_id = ?", [fromPrefix, toPrefix, sessionId]);
    db.run("UPDATE messages_fts SET text = REPLACE(text, ?, ?) WHERE session_id = ?", [fromPrefix, toPrefix, sessionId]);
    // The summary quotes attachment paths too, so a fork has to retarget it or it keeps pointing at the source session.
    db.run("UPDATE compactions SET summary = REPLACE(summary, ?, ?) WHERE session_id = ?", [fromPrefix, toPrefix, sessionId]);
  })();
}

export const rowToCompaction = (r: any): CompactionInfo => ({
  id: r.id,
  cutSeq: r.cut_seq,
  summary: r.summary,
  tokensBefore: r.tokens_before,
  createdAt: r.created_at,
  auto: !!r.auto,
});

export function listCompactions(sessionId: string): CompactionInfo[] {
  return db.query("SELECT * FROM compactions WHERE session_id = ? ORDER BY cut_seq").all(sessionId).map(rowToCompaction);
}

export function addCompaction(sessionId: string, cutSeq: number, summary: string, tokensBefore: number, auto: boolean): CompactionInfo {
  const now = Date.now();
  const res = db.run("INSERT INTO compactions (session_id, cut_seq, summary, tokens_before, auto, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    sessionId,
    cutSeq,
    summary,
    tokensBefore,
    auto ? 1 : 0,
    now,
  ]);
  return { id: Number(res.lastInsertRowid), cutSeq, summary, tokensBefore, auto, createdAt: now };
}

export function searchMessages(query: string, limit = 30, excludeSession?: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  let rows: any[];
  if ([...q].length >= 3) {
    const match = q
      .split(/\s+/)
      .filter((t) => [...t].length >= 3)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(" AND ");
    rows = db
      .query(
        `SELECT f.session_id sessionId, CAST(f.seq AS INTEGER) seq, f.role role,
           snippet(messages_fts, 0, '«', '»', '…', 24) snippet, s.title title, s.updated_at updatedAt
         FROM messages_fts f JOIN sessions s ON s.id = f.session_id
         WHERE messages_fts MATCH ? AND s.kind = 'main' AND f.session_id != ?
         ORDER BY s.updated_at DESC LIMIT ?`,
      )
      .all(match || `"${q}"`, excludeSession ?? "", limit);
  } else {
    rows = db
      .query(
        `SELECT f.session_id sessionId, CAST(f.seq AS INTEGER) seq, f.role role, substr(f.text, max(1, instr(f.text, ?) - 40), 120) snippet,
           s.title title, s.updated_at updatedAt
         FROM messages_fts f JOIN sessions s ON s.id = f.session_id
         WHERE f.text LIKE ? AND s.kind = 'main' AND f.session_id != ?
         ORDER BY s.updated_at DESC LIMIT ?`,
      )
      .all(q, `%${q}%`, excludeSession ?? "", limit);
  }
  const titleHits = db
    .query(`SELECT id sessionId, title, updated_at updatedAt FROM sessions WHERE kind = 'main' AND title LIKE ? AND id != ? ORDER BY updated_at DESC LIMIT 10`)
    .all(`%${q}%`, excludeSession ?? "") as any[];
  const seen = new Set(rows.map((r) => r.sessionId));
  for (const t of titleHits) {
    if (!seen.has(t.sessionId)) rows.unshift({ ...t, seq: -1, role: "title", snippet: t.title });
  }
  return rows;
}
