// Persisted merges run independently of an RPC connection. Generation is retried only by the user;
// delivery waits for an idle target and commits the note and source archive in one transaction.
import type { ChatMessage } from "../shared/protocol";
import * as store from "./db";
import { peekRunner } from "./agent/runner";
import { emit } from "./hub";
import { st } from "./i18n";
import { prepareMerge } from "./merge";
import { logger } from "./log";

const log = logger("merge");

import type { MergeJob } from "../shared/protocol";
export type { MergeJob } from "../shared/protocol";
const active = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;

export function listMergeJobs(): MergeJob[] {
  return store.db.query(`SELECT id, source_id sourceId, target_id targetId, state, error, created_at createdAt
    FROM merge_jobs WHERE state IN ('queued', 'running', 'ready') OR id IN
    (SELECT id FROM merge_jobs ORDER BY created_at DESC LIMIT 100) ORDER BY created_at DESC`).all() as MergeJob[];
}

function busy(id: string) {
  const r = peekRunner(id);
  const s = store.getSession(id);
  return !!(r?.busy || r?.runPromise || r?.queued.length || s?.status === "running" || s?.status === "waiting");
}

export function assertNotMerging(id: string) {
  if (store.db.query("SELECT id FROM merge_jobs WHERE source_id = ? AND state IN ('queued', 'running', 'ready')").get(id)) {
    throw new Error(st("sessionBusy"));
  }
}

export function queueMerge(sourceId: string, targetId: string, instructions?: string): MergeJob {
  if (sourceId === targetId) throw new Error(st("mergeSelf"));
  for (const id of [sourceId, targetId]) {
    const s = store.getSession(id);
    if (!s || s.kind !== "main" || s.archived) throw new Error(st("sessionNotFound"));
  }
  const existing = listMergeJobs().find((j) => j.sourceId === sourceId && ["queued", "running", "ready"].includes(j.state));
  if (existing) {
    if (existing.targetId !== targetId) throw new Error(st("sessionBusy"));
    return existing;
  }
  // Do not allow a chain/cycle of merges to archive a target while it is receiving another source.
  if (listMergeJobs().some((j) => ["queued", "running", "ready"].includes(j.state) && (j.sourceId === targetId || j.targetId === sourceId))) throw new Error(st("sessionBusy"));
  // An explicit retry replaces the failed card and retains the original summarization instructions.
  const failed = store.db.query("SELECT instructions FROM merge_jobs WHERE source_id = ? AND target_id = ? AND state = 'failed' ORDER BY created_at DESC LIMIT 1").get(sourceId, targetId) as { instructions: string | null } | null;
  instructions ??= failed?.instructions ?? undefined;
  store.db.run("DELETE FROM merge_jobs WHERE source_id = ? AND target_id = ? AND state = 'failed'", [sourceId, targetId]);
  const id = crypto.randomUUID();
  const now = Date.now();
  store.db.run("INSERT INTO merge_jobs (id, source_id, target_id, state, instructions, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)", [id, sourceId, targetId, instructions ?? null, now, now]);
  log.info("merge queued", { jobId: id, sourceId, targetId });
  void drainMergeJobs();
  return { id, sourceId, targetId, state: "queued", error: null, createdAt: now };
}

async function run(job: MergeJob) {
  if (busy(job.sourceId)) return;
  if (!store.getSession(job.sourceId) || !store.getSession(job.targetId)) throw new Error(st("sessionNotFound"));
  const row = store.db.query("SELECT * FROM merge_jobs WHERE id = ?").get(job.id) as any;
  let note: ChatMessage;
  let snapshot: string;
  if (row.state === "ready") {
    note = JSON.parse(row.summary);
    snapshot = row.snapshot;
  } else {
    snapshot = JSON.stringify({ messages: store.loadMessages(job.sourceId), compactions: store.listCompactions(job.sourceId) });
    store.db.run("UPDATE merge_jobs SET state = 'running', snapshot = ?, updated_at = ? WHERE id = ?", [snapshot, Date.now(), job.id]);
    note = await prepareMerge(job.sourceId, job.targetId, row.instructions ?? undefined);
    store.db.run("UPDATE merge_jobs SET state = 'ready', summary = ?, updated_at = ? WHERE id = ?", [JSON.stringify(note), Date.now(), job.id]);
  }
  if (busy(job.targetId) || busy(job.sourceId)) return;
  if (snapshot !== JSON.stringify({ messages: store.loadMessages(job.sourceId), compactions: store.listCompactions(job.sourceId) })) throw new Error(st("mergeChanged"));
  let stored: ReturnType<typeof store.appendMessage> | undefined;
  store.db.transaction(() => {
    const source = store.getSession(job.sourceId);
    const target = store.getSession(job.targetId);
    if (!source || source.archived || !target || target.archived) throw new Error(st("sessionNotFound"));
    stored = store.appendMessage(job.targetId, note);
    store.updateSession(job.sourceId, { archived: true, mergedInto: job.targetId }, true);
    store.db.run("UPDATE merge_jobs SET state = 'succeeded', updated_at = ? WHERE id = ?", [Date.now(), job.id]);
  })();
  log.info("merge delivered", { jobId: job.id, sourceId: job.sourceId, targetId: job.targetId });
  peekRunner(job.targetId)?.reloadFromDb();
  if (stored) emit({ type: "message_appended", sessionId: job.targetId, stored });
  for (const id of [job.sourceId, job.targetId]) emit({ type: "session_updated", session: store.getSession(id)! });
}

export async function drainMergeJobs() {
  for (const job of listMergeJobs().reverse()) {
    if (!["queued", "ready"].includes(job.state) || active.has(job.id)) continue;
    // One worker per target. Other sessions can merge concurrently.
    if (listMergeJobs().some((x) => x.targetId === job.targetId && active.has(x.id))) continue;
    active.add(job.id);
    void run(job).catch((e) => {
      log.error("merge failed", { jobId: job.id, sourceId: job.sourceId, targetId: job.targetId, error: e });
      store.db.run("UPDATE merge_jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?", [e?.message ?? String(e), Date.now(), job.id]);
    }).finally(() => active.delete(job.id));
  }
}

export function startMergeJobs() {
  const interrupted = store.db.run("UPDATE merge_jobs SET state = 'failed', error = ? WHERE state = 'running'", [st("mergeInterrupted")]);
  if (interrupted.changes) log.warn("merges interrupted by the last shutdown", { count: interrupted.changes });
  if (timer) clearInterval(timer);
  timer = setInterval(() => void drainMergeJobs(), 1000);
  timer.unref();
  void drainMergeJobs();
}
