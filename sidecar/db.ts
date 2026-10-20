import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  ChatMessage,
  CompactionInfo,
  McpServerConfig,
  ModelConfig,
  ProviderConfig,
  SearchHit,
  SessionInfo,
  StoredMessage,
  UsageSummary,
} from "../shared/protocol";
import { HOME } from "./env";
import { DEFAULT_BASH_WHITELIST } from "./permissions";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE models (
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    context_window INTEGER NOT NULL DEFAULT 128000,
    max_tokens INTEGER NOT NULL DEFAULT 16384,
    reasoning INTEGER NOT NULL DEFAULT 0,
    vision INTEGER NOT NULL DEFAULT 0,
    cost_input REAL NOT NULL DEFAULT 0,
    cost_output REAL NOT NULL DEFAULT 0,
    cost_cache_read REAL NOT NULL DEFAULT 0,
    cost_cache_write REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, id)
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    thinking TEXT NOT NULL DEFAULT 'medium',
    permission_mode TEXT NOT NULL DEFAULT 'default',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'main',
    parent_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    todos TEXT NOT NULL DEFAULT '[]',
    usage_input INTEGER NOT NULL DEFAULT 0,
    usage_output INTEGER NOT NULL DEFAULT 0,
    usage_cache_read INTEGER NOT NULL DEFAULT 0,
    usage_cache_write INTEGER NOT NULL DEFAULT 0,
    usage_cost REAL NOT NULL DEFAULT 0,
    context_tokens INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_updated ON sessions(updated_at DESC);
  CREATE TABLE messages (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  );
  CREATE TABLE compactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cut_seq INTEGER NOT NULL,
    summary TEXT NOT NULL,
    tokens_before INTEGER NOT NULL DEFAULT 0,
    auto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cost REAL NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'chat',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX usage_events_time ON usage_events(created_at);
  CREATE TABLE tool_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    is_error INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX tool_events_time ON tool_events(created_at);
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL,
    command TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    url TEXT NOT NULL DEFAULT '',
    headers TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE permission_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    pattern TEXT NOT NULL,
    decision TEXT NOT NULL,
    scope TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, role UNINDEXED, tokenize = 'trigram');
  `,
  `
  UPDATE sessions SET permission_mode = CASE permission_mode WHEN 'plan' THEN 'manual' WHEN 'default' THEN 'whitelist' ELSE permission_mode END;
  DROP TABLE IF EXISTS permission_rules;
  `,
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  `,
  `
  UPDATE sessions SET permission_mode = 'auto' WHERE permission_mode = 'whitelist';
  `,
];

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  theme: "system",
  accent: "neutral",
  defaultCwd: HOME,
  defaultProviderId: "",
  defaultModelId: "",
  defaultThinking: "medium",
  defaultPermissionMode: "auto",
  titleModel: "",
  compactModel: "",
  autoCompact: true,
  compactThreshold: 0.8,
  keepRecentTokens: 24000,
  systemPromptAppend: "",
  instructionFiles: ["~/.kestrel/AGENTS.md", "~/.claude/CLAUDE.md"],
  loadProjectInstructions: true,
  skillDirs: ["~/.kestrel/skills", "~/.claude/skills", "~/.agents/skills"],
  disabledSkills: [],
  commandDirs: ["~/.kestrel/commands", "~/.claude/commands"],
  memoryEnabled: true,
  memoryAutoSave: true,
  proxyMode: "env",
  proxyUrl: "",
  bashTimeoutSec: 120,
  bashWhitelist: DEFAULT_BASH_WHITELIST,
  toolWhitelist: [],
  autoModel: "",
  autoEnvironment: "",
  autoBlockRules: "",
  autoAllowRules: "",
  notifyOnFinish: true,
  sendKey: "enter",
  transcriptView: "compact",
  remoteEnabled: false,
  remotePort: 47830,
};

export let db: Database;
export let dbPath = "";

function importLegacyDb(dataDir: string, target: string, dev: boolean) {
  if (fs.existsSync(target)) return;
  const legacy = path.join(path.dirname(dataDir), "com.zhaoshangqi.helm", dev ? "helm-dev.db" : "helm.db");
  if (!fs.existsSync(legacy)) return;
  const old = new Database(legacy);
  try {
    old.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    old.close();
  }
}

export function openDb(dataDir: string, dev: boolean) {
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, dev ? "kestrel-dev.db" : "kestrel.db");
  importLegacyDb(dataDir, dbPath, dev);
  db = new Database(dbPath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((db.query("SELECT version FROM _migrations").all() as { version: number }[]).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    db.transaction(() => {
      db.run(sql);
      db.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [v, Date.now()]);
    })();
  });
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {}
  db.run("UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'waiting')");
}

const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

// ---------- settings ----------

const PERMISSION_MODES = new Set(["manual", "acceptEdits", "auto", "bypass"]);

export function getSettings(): AppSettings {
  const row = db.query("SELECT value FROM meta WHERE key = 'settings'").get() as { value: string } | null;
  const s = { ...DEFAULT_SETTINGS, ...json<Partial<AppSettings>>(row?.value, {}) };
  // "whitelist" was renamed to "auto" (the allowlist now feeds a smarter mode).
  if ((s.defaultPermissionMode as string) === "whitelist") s.defaultPermissionMode = "auto";
  if (!PERMISSION_MODES.has(s.defaultPermissionMode)) s.defaultPermissionMode = "auto";
  return s;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  db.run("INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    JSON.stringify(next),
  ]);
  return next;
}

// ---------- providers & models ----------

const rowToProvider = (r: any): ProviderConfig => ({
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
  db.run(
    `INSERT INTO providers (id, kind, name, base_url, api_key, headers, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, base_url = excluded.base_url,
       api_key = excluded.api_key, headers = excluded.headers, enabled = excluded.enabled`,
    [p.id, p.kind, p.name, p.baseUrl, p.apiKey, JSON.stringify(p.headers ?? {}), p.enabled ? 1 : 0, p.createdAt || Date.now()],
  );
}

export function deleteProvider(id: string) {
  db.run("DELETE FROM providers WHERE id = ?", [id]);
}

const rowToModel = (r: any): ModelConfig => ({
  providerId: r.provider_id,
  id: r.id,
  name: r.name,
  contextWindow: r.context_window,
  maxTokens: r.max_tokens,
  reasoning: !!r.reasoning,
  vision: !!r.vision,
  cost: { input: r.cost_input, output: r.cost_output, cacheRead: r.cost_cache_read, cacheWrite: r.cost_cache_write },
  enabled: !!r.enabled,
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
    `INSERT INTO models (provider_id, id, name, context_window, max_tokens, reasoning, vision, cost_input, cost_output, cost_cache_read, cost_cache_write, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, id) DO UPDATE SET name = excluded.name, context_window = excluded.context_window,
       max_tokens = excluded.max_tokens, reasoning = excluded.reasoning, vision = excluded.vision,
       cost_input = excluded.cost_input, cost_output = excluded.cost_output, cost_cache_read = excluded.cost_cache_read,
       cost_cache_write = excluded.cost_cache_write, enabled = excluded.enabled`,
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
    ],
  );
}

export function deleteModel(providerId: string, id: string) {
  db.run("DELETE FROM models WHERE provider_id = ? AND id = ?", [providerId, id]);
}

// ---------- sessions ----------

const rowToSession = (r: any): SessionInfo => ({
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
});

const SESSION_SELECT = `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count FROM sessions s`;

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
    `INSERT INTO sessions (id, title, cwd, provider_id, model_id, thinking, permission_mode, pinned, archived, kind, parent_id, status, todos, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  );
}

const SESSION_COLUMNS: Record<string, string> = {
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

export function deleteSession(id: string) {
  db.transaction(() => {
    const children = db.query("SELECT id FROM sessions WHERE parent_id = ? AND kind = 'subagent'").all(id) as { id: string }[];
    for (const c of children) deleteSession(c.id);
    db.run("DELETE FROM messages_fts WHERE session_id = ?", [id]);
    db.run("DELETE FROM sessions WHERE id = ?", [id]);
  })();
}

// ---------- messages ----------

function searchableText(m: ChatMessage): string {
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

export function appendMessage(sessionId: string, message: ChatMessage): StoredMessage {
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
  })();
  return { seq, message };
}

export function truncateMessages(sessionId: string, fromSeq: number) {
  db.transaction(() => {
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

// ---------- compactions ----------

const rowToCompaction = (r: any): CompactionInfo => ({
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

// ---------- events ----------

export function recordUsage(e: {
  sessionId: string;
  providerId: string;
  modelId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  purpose: string;
}) {
  db.run(
    "INSERT INTO usage_events (session_id, provider_id, model_id, input, output, cache_read, cache_write, cost, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [e.sessionId, e.providerId, e.modelId, e.input, e.output, e.cacheRead, e.cacheWrite, e.cost, e.purpose, Date.now()],
  );
}

export function recordToolEvent(sessionId: string, tool: string, isError: boolean, durationMs: number) {
  db.run("INSERT INTO tool_events (session_id, tool_name, is_error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)", [
    sessionId,
    tool,
    isError ? 1 : 0,
    Math.round(durationMs),
    Date.now(),
  ]);
}

export function usageSummary(days: number): UsageSummary {
  const since = days > 0 ? Date.now() - days * 86400_000 : 0;
  const totals = db
    .query(
      `SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(input),0) input, COALESCE(SUM(output),0) output,
        COALESCE(SUM(cache_read),0) cacheRead, COALESCE(SUM(cache_write),0) cacheWrite, COUNT(*) requests,
        COUNT(DISTINCT session_id) sessions FROM usage_events WHERE created_at >= ?`,
    )
    .get(since) as any;
  const tools = db
    .query("SELECT COUNT(*) c, COALESCE(SUM(is_error),0) e FROM tool_events WHERE created_at >= ?")
    .get(since) as any;
  const daily = db
    .query(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') day, model_id model,
        SUM(cost) cost, SUM(input + output + cache_read + cache_write) tokens
       FROM usage_events WHERE created_at >= ? GROUP BY day, model ORDER BY day`,
    )
    .all(since) as any[];
  const byModel = db
    .query(
      `SELECT u.model_id model, COALESCE(p.name, u.provider_id) provider, SUM(cost) cost,
        SUM(input + output + cache_read + cache_write) tokens, COUNT(*) requests
       FROM usage_events u LEFT JOIN providers p ON p.id = u.provider_id
       WHERE u.created_at >= ? GROUP BY u.provider_id, u.model_id ORDER BY tokens DESC`,
    )
    .all(since) as any[];
  const byTool = db
    .query(
      `SELECT tool_name tool, COUNT(*) count, SUM(is_error) errors, AVG(duration_ms) avgMs
       FROM tool_events WHERE created_at >= ? GROUP BY tool_name ORDER BY count DESC LIMIT 20`,
    )
    .all(since) as any[];
  const byHour = db
    .query(
      `SELECT CAST(strftime('%w', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) weekday,
        CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) hour, COUNT(*) count
       FROM usage_events WHERE created_at >= ? GROUP BY weekday, hour`,
    )
    .all(since) as any[];
  const topSessions = db
    .query(
      `SELECT s.id, s.title, SUM(u.cost) cost, SUM(u.input + u.output + u.cache_read + u.cache_write) tokens, s.updated_at updatedAt
       FROM usage_events u JOIN sessions s ON s.id = u.session_id
       WHERE u.created_at >= ? GROUP BY s.id ORDER BY tokens DESC LIMIT 8`,
    )
    .all(since) as any[];
  return {
    totals: { ...totals, toolCalls: tools.c, toolErrors: tools.e },
    daily,
    byModel,
    byTool: byTool.map((t) => ({ ...t, avgMs: Math.round(t.avgMs ?? 0) })),
    byHour,
    topSessions,
  };
}

// ---------- search ----------

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

// ---------- mcp ----------

const rowToMcp = (r: any): McpServerConfig => ({
  id: r.id,
  name: r.name,
  transport: r.transport,
  command: r.command,
  args: json(r.args, []),
  env: json(r.env, {}),
  url: r.url,
  headers: json(r.headers, {}),
  enabled: !!r.enabled,
});

export function listMcpServers(): McpServerConfig[] {
  return db.query("SELECT * FROM mcp_servers ORDER BY created_at").all().map(rowToMcp);
}

export function upsertMcpServer(s: McpServerConfig) {
  db.run(
    `INSERT INTO mcp_servers (id, name, transport, command, args, env, url, headers, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, transport = excluded.transport, command = excluded.command,
       args = excluded.args, env = excluded.env, url = excluded.url, headers = excluded.headers, enabled = excluded.enabled`,
    [s.id, s.name, s.transport, s.command, JSON.stringify(s.args), JSON.stringify(s.env), s.url, JSON.stringify(s.headers), s.enabled ? 1 : 0, Date.now()],
  );
}

export function deleteMcpServer(id: string) {
  db.run("DELETE FROM mcp_servers WHERE id = ?", [id]);
}

// ---------- paired devices ----------

export interface DeviceRow {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

const rowToDevice = (r: any): DeviceRow => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at });

export function listDevices(): DeviceRow[] {
  return db.query("SELECT * FROM devices ORDER BY created_at").all().map(rowToDevice);
}

export function addDevice(id: string, name: string, tokenHash: string) {
  const now = Date.now();
  db.run("INSERT INTO devices (id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)", [id, name, tokenHash, now, now]);
}

export function deviceByTokenHash(tokenHash: string): DeviceRow | null {
  const r = db.query("SELECT * FROM devices WHERE token_hash = ?").get(tokenHash);
  return r ? rowToDevice(r) : null;
}

export function touchDevice(id: string) {
  db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [Date.now(), id]);
}

export function deleteDevice(id: string) {
  db.run("DELETE FROM devices WHERE id = ?", [id]);
}

export function deleteAllDevices() {
  db.run("DELETE FROM devices");
}
