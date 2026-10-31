// Usage and tool events, and the summaries the usage page shows.
import type { UsageSummary } from "../../shared/protocol";
import { db } from "./connection";

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
