// Session records: listing, creating, patching, usage totals and deletion with their subagents.
import type { SessionInfo } from "../../shared/protocol";
import { db, json } from "./connection";

export const rowToSession = (r: any): SessionInfo => ({
  id: r.id,
  title: r.title,
  cwd: r.cwd,
  providerId: r.provider_id,
  modelId: r.model_id,
  thinking: r.thinking,
  permissionMode: r.permission_mode,
  pinned: !!r.pinned,
  archived: !!r.archived,
  kind: r.kind,
  parentId: r.parent_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  status: r.status,
  todos: json(r.todos, []),
  usage: {
    input: r.usage_input,
    output: r.usage_output,
    cacheRead: r.usage_cache_read,
    cacheWrite: r.usage_cache_write,
    cost: r.usage_cost,
    contextTokens: r.context_tokens,
  },
  lastError: r.last_error,
  messageCount: r.message_count ?? 0,
  forkOf: r.fork_of ?? null,
  forkSeq: r.fork_seq ?? null,
  mergedInto: r.merged_into ?? null,
});

export const SESSION_SELECT = `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count FROM sessions s`;

export function listSessions(opts: { archived?: boolean; kind?: string } = {}): SessionInfo[] {
  return db
    .query(`${SESSION_SELECT} WHERE s.archived = ? AND s.kind = ? ORDER BY s.pinned DESC, s.updated_at DESC`)
    .all(opts.archived ? 1 : 0, opts.kind ?? "main")
    .map(rowToSession);
}

export function getSession(id: string): SessionInfo | null {
  const r = db.query(`${SESSION_SELECT} WHERE s.id = ?`).get(id);
  return r ? rowToSession(r) : null;
}

export function insertSession(s: SessionInfo) {
  db.run(
    `INSERT INTO sessions (id, title, cwd, provider_id, model_id, thinking, permission_mode, pinned, archived, kind, parent_id, status, todos, created_at, updated_at, fork_of, fork_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.title,
      s.cwd,
      s.providerId,
      s.modelId,
      s.thinking,
      s.permissionMode,
      s.pinned ? 1 : 0,
      s.archived ? 1 : 0,
      s.kind,
      s.parentId,
      s.status,
      JSON.stringify(s.todos),
      s.createdAt,
      s.updatedAt,
      s.forkOf,
      s.forkSeq,
    ],
  );
}

export const SESSION_COLUMNS: Record<string, string> = {
  title: "title",
  cwd: "cwd",
  providerId: "provider_id",
  modelId: "model_id",
  thinking: "thinking",
  permissionMode: "permission_mode",
  pinned: "pinned",
  archived: "archived",
  status: "status",
  lastError: "last_error",
  mergedInto: "merged_into",
};

export function updateSession(id: string, patch: Partial<SessionInfo>, touch = false) {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "todos") {
      sets.push("todos = ?");
      vals.push(JSON.stringify(v));
    } else if (SESSION_COLUMNS[k]) {
      sets.push(`${SESSION_COLUMNS[k]} = ?`);
      vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    }
  }
  if (touch) {
    sets.push("updated_at = ?");
    vals.push(Date.now());
  }
  if (!sets.length) return;
  vals.push(id);
  db.run(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export function addSessionUsage(
  id: string,
  u: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number },
  contextTokens: number | null,
) {
  db.run(
    `UPDATE sessions SET usage_input = usage_input + ?, usage_output = usage_output + ?, usage_cache_read = usage_cache_read + ?,
       usage_cache_write = usage_cache_write + ?, usage_cost = usage_cost + ?, context_tokens = COALESCE(?, context_tokens) WHERE id = ?`,
    [u.input, u.output, u.cacheRead, u.cacheWrite, u.cost, contextTokens, id],
  );
}

export function setContextTokens(id: string, tokens: number) {
  db.run("UPDATE sessions SET context_tokens = ? WHERE id = ?", [tokens, id]);
}

export function deleteSession(id: string): string[] {
  const deleted: string[] = [];
  const walk = (sessionId: string) => {
    const children = db.query("SELECT id FROM sessions WHERE parent_id = ? AND kind = 'subagent'").all(sessionId) as { id: string }[];
    for (const c of children) walk(c.id);
    db.run("DELETE FROM messages_fts WHERE session_id = ?", [sessionId]);
    const res = db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
    // An id that matches no session must not be reported as deleted: the caller removes files by these ids.
    if (res.changes > 0) deleted.push(sessionId);
  };
  db.transaction(() => {
    walk(id);
  })();
  return deleted;
}
