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

export async function run(runner: SessionRunner, fn: () => Promise<void>): Promise<void> {
  await shellEnvReady();
  try {
    setup.prepare(runner);
  } catch (e: any) {
    store.updateSession(runner.id, { status: "error", lastError: e.message });
    runner.emitSession();
    emit({ type: "notice", sessionId: runner.rootId, level: "error", text: e.message });
    throw e;
  }
  store.updateSession(runner.id, { status: "running", lastError: null }, true);
  runner.emitSession();
  runner.setPhase("preparing");
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
      runner.dropTrailingFailure();
      emit({ type: "notice", sessionId: runner.rootId, level: "info", text: st("overflowRetry") });
      await context.compact(runner, { auto: true, full: false });
      await runner.agent.continue();
    }
    const final = runner.agent.state.messages[runner.agent.state.messages.length - 1] as any;
    if (final?.role === "assistant" && final.stopReason === "error") {
      ok = false;
      store.updateSession(runner.id, { status: "error", lastError: final.errorMessage ?? "Unknown error" });
    } else {
      store.updateSession(runner.id, { status: "idle", lastError: null });
    }
  } catch (e: any) {
    ok = false;
    store.updateSession(runner.id, { status: "error", lastError: e?.message ?? String(e) });
  } finally {
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
