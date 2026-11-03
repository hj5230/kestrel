// The agent's events turned into the app's: streamed text, stored messages, usage, tool progress and the title.
import { generateText } from "ai";
import type { ChatMessage, SessionInfo } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";
import { st } from "../i18n";
import { languageModel } from "../providers";
import { recordSideUsage, sideModel, usageOf } from "../side-model";
import { clampTitle } from "../titles";
import { memoryConfigured } from "../memory-config";
import { memoryEpoch } from "../memory";
import type { SessionRunner } from "./session-runner";
import { visibleBlock, usageCost } from "./text";
import { finishQuestionTool } from "../db/questions";

export function flushStream(runner: SessionRunner) {
  runner.streamTimer = null;
  runner.lastStreamEmit = Date.now();
  emit({ type: "stream", sessionId: runner.id, message: runner.streaming });
}

export function onEvent(runner: SessionRunner, e: any) {
  switch (e.type) {
    case "message_start":
      if (e.message.role === "assistant") {
        runner.streaming = e.message;
        runner.setPhase("responding");
        flushStream(runner);
      }
      break;
    case "message_update":
      if (e.message.role === "assistant") {
        runner.streaming = e.message;
        if (e.message.content.some(visibleBlock)) runner.setPhase(null);
        const wait = 40 - (Date.now() - runner.lastStreamEmit);
        if (wait <= 0) flushStream(runner);
        else if (!runner.streamTimer) runner.streamTimer = setTimeout(() => flushStream(runner), wait);
      }
      break;
    case "message_end": {
      const msg = e.message as ChatMessage;
      if (msg.role === "assistant") {
        if (runner.streamTimer) clearTimeout(runner.streamTimer);
        runner.streamTimer = null;
        runner.streaming = null;
      }
      const settings = store.getSettings();
      const epoch = msg.role === "user" && runner.info().kind === "main" && settings.memoryEnabled && settings.memoryAutoSave && memoryConfigured(settings) ? memoryEpoch() : undefined;
      const stored = store.appendMessage(runner.id, msg, epoch);
      if (msg.role === "toolResult" && msg.toolName === "ask_user") finishQuestionTool(runner.id, msg.toolCallId);
      emit({ type: "message_appended", sessionId: runner.id, stored });
      if (msg.role === "assistant") {
        emit({ type: "stream", sessionId: runner.id, message: null });
        const u = usageCost(msg.usage);
        const ctxTokens = (msg.usage?.input ?? 0) + (msg.usage?.cacheRead ?? 0) + (msg.usage?.cacheWrite ?? 0) + (msg.usage?.output ?? 0);
        const s = runner.info();
        if (u.input || u.output || u.cacheRead || u.cacheWrite) {
          store.recordUsage({ sessionId: runner.id, providerId: s.providerId, modelId: msg.model, ...u, purpose: s.kind === "subagent" ? "subagent" : "chat" });
          store.addSessionUsage(runner.id, u, ctxTokens > 0 ? ctxTokens : null);
          if (runner.parent) {
            store.addSessionUsage(runner.parent.id, u, null);
            runner.parent.emitSession();
          }
        }
        runner.emitSession();
        maybeTitle(runner, s);
      } else if (msg.role === "user") {
        const qi = runner.queued.findIndex((q) => q.ts === msg.timestamp);
        if (qi >= 0) {
          runner.queued.splice(qi, 1);
          runner.emitQueue();
        }
      }
      break;
    }
    case "tool_execution_start":
      runner.toolStarted.set(e.toolCallId, Date.now());
      runner.runningTools[e.toolCallId] = { toolName: e.toolName, args: e.args, partial: null, startedAt: Date.now() };
      emit({ type: "tool_start", sessionId: runner.id, toolCallId: e.toolCallId, toolName: e.toolName, args: e.args });
      break;
    case "tool_execution_update": {
      const rt = runner.runningTools[e.toolCallId];
      if (rt) rt.partial = e.partialResult?.details ?? e.partialResult;
      const last = runner.toolEmitAt.get(e.toolCallId) ?? 0;
      if (Date.now() - last > 100) {
        runner.toolEmitAt.set(e.toolCallId, Date.now());
        emit({ type: "tool_update", sessionId: runner.id, toolCallId: e.toolCallId, partial: rt?.partial });
      }
      break;
    }
    case "tool_execution_end": {
      const started = runner.toolStarted.get(e.toolCallId) ?? Date.now();
      runner.toolStarted.delete(e.toolCallId);
      runner.toolEmitAt.delete(e.toolCallId);
      delete runner.runningTools[e.toolCallId];
      store.recordToolEvent(runner.id, e.toolName, !!e.isError, Date.now() - started);
      emit({ type: "tool_end", sessionId: runner.id, toolCallId: e.toolCallId });
      break;
    }
  }
}

export function maybeTitle(runner: SessionRunner, s: SessionInfo) {
  if (s.kind !== "main" || s.title || runner.titlePending) return;
  // A fork is named by the first message sent in it, not by the history it shares with its source.
  const after = s.forkOf && s.forkSeq !== null ? s.forkSeq : -1;
  const firstUser = runner.agent.state.messages.find((m: any, i) => i > after && m.role === "user" && !m.merge) as any;
  if (!firstUser) return;
  const text: string =
    firstUser.display ??
    (typeof firstUser.content === "string" ? firstUser.content : firstUser.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"));
  const fallback = clampTitle(text, st("untitled")) || st("untitled");
  runner.titlePending = true;
  let side: ReturnType<typeof sideModel>;
  try {
    side = sideModel(store.getSettings().titleModel, s);
  } catch {
    runner.titlePending = false;
    return;
  }
  generateText({
    model: languageModel(side.providerId, side.modelId),
    system:
      "Write a very short title for the conversation that starts with the user's message below. Use the user's language. " +
      "Hard limit: 12 Chinese characters, or 4 English words (about 24 characters); shorter is better. " +
      "Name the topic as a noun phrase, not a sentence: no 'Help me…', no quotes, no punctuation at the end. " +
      "Examples: 重构解析器 / 修复登录超时 / Parser refactor / Login timeout fix. Output only the title.",
    prompt: text.slice(0, 3000),
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30000),
  })
    .then((r) => {
      recordSideUsage(runner.id, "title", side, usageOf(r.usage));
      return clampTitle(r.text, fallback);
    })
    .catch(() => fallback)
    .then((title) => {
      const cur = store.getSession(runner.id);
      if (cur && !cur.title) {
        store.updateSession(runner.id, { title });
        runner.emitSession();
      }
    });
}
