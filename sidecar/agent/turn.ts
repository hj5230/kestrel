// One run of the agent from start to finish: status, the context-overflow retry, and what is left to clean up.
import { isContextOverflow } from "@mariozechner/pi-ai";
import * as store from "../db";
import { shellEnvReady } from "../env";
import { emit } from "../hub";
import { st } from "../i18n";
import { drainMemoryJobs } from "../memory-jobs";
import type { SessionRunner } from "./session-runner";
import * as setup from "./setup";
import * as context from "./context";
import { appendStopMarker } from "./stop-marker";
import { logger } from "../log";

const log = logger("agent");

export async function run(runner: SessionRunner, fn: () => Promise<void>): Promise<void> {
  runner.stopRequested = false;
  const t0 = Date.now();
  const startSeq = store.loadMessages(runner.id).length;
  await shellEnvReady();
  if (runner.stopRequested) {
    appendStopMarker(runner.id, startSeq);
    return;
  }
  try {
    setup.prepare(runner);
  } catch (e: any) {
    log.warn("run could not start", { sessionId: runner.id, error: e });
    store.updateSession(runner.id, { status: "error", lastError: e.message });
    runner.emitSession();
    emit({ type: "notice", sessionId: runner.rootId, level: "error", text: e.message });
    throw e;
  }
  store.updateSession(runner.id, { status: "running", lastError: null }, true);
  runner.emitSession();
  runner.setPhase("preparing");
  const info = runner.info();
  log.info("run started", { sessionId: runner.id, kind: info.kind, provider: info.providerId, model: info.modelId, thinking: info.thinking, permissionMode: info.permissionMode, messages: startSeq });
  let ok = true;
  try {
    await fn();
    const last = runner.agent.state.messages[runner.agent.state.messages.length - 1] as any;
    if (
      last?.role === "assistant" &&
      last.stopReason === "error" &&
      !runner.overflowRetried &&
      isContextOverflow(last, runner.agent.state.model.contextWindow)
    ) {
      runner.overflowRetried = true;
      log.warn("context overflow, compacting and retrying", { sessionId: runner.id, contextWindow: runner.agent.state.model.contextWindow });
      runner.dropTrailingFailure();
      emit({ type: "notice", sessionId: runner.rootId, level: "info", text: st("overflowRetry") });
      await context.compact(runner, { auto: true, full: false });
      await runner.agent.continue();
    }
    const final = runner.agent.state.messages[runner.agent.state.messages.length - 1] as any;
    if (final?.role === "assistant" && final.stopReason === "error") {
      ok = false;
      log.error("run ended with a model error", { sessionId: runner.id, model: info.modelId, error: final.errorMessage ?? "Unknown error" });
      store.updateSession(runner.id, { status: "error", lastError: final.errorMessage ?? "Unknown error" });
    } else {
      store.updateSession(runner.id, { status: "idle", lastError: null });
    }
  } catch (e: any) {
    ok = false;
    log.error("run failed", { sessionId: runner.id, model: info.modelId, error: e });
    store.updateSession(runner.id, { status: "error", lastError: e?.message ?? String(e) });
  } finally {
    if (runner.stopRequested) {
      appendStopMarker(runner.id, startSeq);
      runner.agent.state.messages = store.loadMessages(runner.id).map((s) => s.message as any);
      store.updateSession(runner.id, { status: "idle", lastError: null });
      ok = true;
    }
    log.info("run finished", { sessionId: runner.id, ok, stopped: runner.stopRequested, ms: Date.now() - t0, queuedLeft: runner.queued.length });
    runner.overflowRetried = false;
    runner.streaming = null;
    runner.setPhase(null);
    runner.runningTools = {};
    if (runner.queued.length && !runner.agent.hasQueuedMessages()) {
      runner.queued = [];
      runner.emitQueue();
    }
    runner.emitSession();
    const s = store.getSession(runner.id);
    if (s?.kind === "main") {
      emit({ type: "run_finished", sessionId: runner.id, title: s.title || st("sessionFallback"), ok });
      void drainMemoryJobs();
    }
  }
}

export function start(runner: SessionRunner, fn: () => Promise<void>): Promise<void> {
  const p = run(runner, fn).finally(() => {
    if (runner.runPromise === p) runner.runPromise = null;
  });
  runner.runPromise = p;
  return p;
}
