// The permission gate before each tool call: rules, auto review, and asking the user (approvals and ask_user).
import path from "node:path";
import type { ApprovalDecision, ApprovalRequest, Question, QuestionAnswer, QuestionRequest } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";
import { buildTranscript, describeAction, partsFromMessages, reviewAction, reviewerConfigured } from "../auto-review";
import { evaluatePermission, isBroadEntry, type PermissionResult } from "../permissions";
import { parseModelSetting, recordSideUsage } from "../side-model";
import { newId } from "../sessions";
import { sanitizeAnswers } from "../tools/ask";
import type { KestrelTool } from "../tools/types";
import type { SessionRunner } from "./session-runner";
import { approvals, pendingQuestions } from "./pending";
import { saveQuestion } from "../db/questions";
import { logger } from "../log";

const log = logger("permission");

/** What the reviewer reads: the user's words, what the user approved by hand, and the agent's tool calls. */
export function reviewTranscript(runner: SessionRunner): string {
  const own = runner.agent.state.messages;
  const approved = runner.root().gate.approved.map((text) => ({ role: "approved" as const, text }));
  if (!runner.parent) return buildTranscript([...approved, ...partsFromMessages(own)]);
  const rootParts = partsFromMessages(runner.root().agent.state.messages).filter((p) => p.role !== "tool_call");
  return buildTranscript([...approved, ...rootParts, ...partsFromMessages(own, { firstUserIsTask: true })]);
}

/** Auto mode: the reviewer decides. Returns null to let the call run; anything it would block, or can't judge, goes to a person. */
export async function autoReview(runner: SessionRunner, tool: KestrelTool, args: unknown, perm: PermissionResult, signal?: AbortSignal): Promise<{ block: true; reason: string } | PermissionResult | null> {
  try {
    const settings = store.getSettings();
    const picked = parseModelSetting(settings.autoModel);
    const r = await reviewAction({
      settings,
      transcript: reviewTranscript(runner),
      action: describeAction(tool, args, runner.info().cwd),
      signal,
      onUsage: (u) => picked && recordSideUsage(runner.id, "review", picked, u),
    });
    if (!r.block) {
      log.debug("auto review allowed", { sessionId: runner.id, tool: tool.name });
      return null;
    }
    log.info("auto review blocked a call", { sessionId: runner.id, tool: tool.name, reason: r.reason });
    // The reviewer is a second opinion, not the last word: the user sees its reason and decides.
    return { ...perm, action: "ask", note: { code: "review_blocked", detail: r.reason } };
  } catch (e: any) {
    if (signal?.aborted) return { block: true, reason: "Operation aborted by the user." };
    log.warn("auto review failed, asking the user", { sessionId: runner.id, tool: tool.name, error: e });
    return { ...perm, action: "ask", note: { code: "review_error", detail: String(e?.message ?? e).slice(0, 200) } };
  }
}

/** The session shows "waiting" while anything (an approval or a question) needs the user. */
export function syncWaiting(runner: SessionRunner) {
  const id = runner.rootId;
  const waiting = [...approvals.values()].some((a) => a.request.sessionId === id) || [...pendingQuestions.values()].some((q) => q.request.sessionId === id);
  const root = store.getSession(id);
  if (!root || (waiting ? root.status === "waiting" : root.status !== "waiting")) return;
  store.updateSession(id, { status: waiting ? "waiting" : "running" });
  const next = store.getSession(id);
  if (next) emit({ type: "session_updated", session: next });
}

/** The `ask_user` tool: show the questions, wait for the answers. Null when dismissed or aborted. */
export async function ask(runner: SessionRunner, req: { toolCallId: string; title?: string; questions: Question[] }, signal?: AbortSignal): Promise<QuestionAnswer[] | null> {
  const request: QuestionRequest = { id: newId("qn_"), sessionId: runner.rootId, createdAt: Date.now(), ...req };
  const answers = await new Promise<QuestionAnswer[] | null>((resolve) => {
    if (signal?.aborted) return resolve(null);
    saveQuestion(request, runner.id);
    const onAbort = () => resolve(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingQuestions.set(request.id, {
      request,
      owner: runner,
      resolve: (a) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(a);
      },
    });
    syncWaiting(runner);
    emit({ type: "question_request", request });
  });
  pendingQuestions.delete(request.id);
  emit({ type: "question_resolved", sessionId: runner.rootId, id: request.id });
  syncWaiting(runner);
  return answers && sanitizeAnswers(req.questions, answers);
}

export async function beforeToolCall(runner: SessionRunner, ctx: { toolCall: any; args: unknown }, signal?: AbortSignal) {
  const tool = (runner.agent.state.tools as KestrelTool[]).find((t) => t.name === ctx.toolCall.name);
  if (!tool) return undefined;
  const s = runner.info();
  const settings = store.getSettings();
  let perm = evaluatePermission(tool, ctx.args, s.permissionMode, settings, {
    cwd: s.cwd,
    dataDir: path.dirname(store.dbPath),
    reviewer: reviewerConfigured(settings),
  });
  if (perm.action === "review") {
    const out = await autoReview(runner, tool, ctx.args, perm, signal);
    if (out === null) return undefined;
    if ("block" in out) return out;
    perm = out;
  }
  if (perm.action === "allow") return undefined;
  if (perm.action === "deny") {
    log.info("tool call denied by rule", { sessionId: runner.id, tool: tool.name, reason: perm.reason });
    return { block: true, reason: perm.reason };
  }

  const request: ApprovalRequest = {
    id: newId("ap_"),
    sessionId: runner.rootId,
    toolCallId: ctx.toolCall.id,
    toolName: tool.name,
    args: ctx.args,
    kind: perm.kind,
    path: perm.path,
    detail: perm.detail,
    subagent: !!runner.parent,
    whitelistSuggestion: perm.suggestion,
    note: perm.note ?? null,
    createdAt: Date.now(),
  };
  const decision = await new Promise<{ decision: ApprovalDecision; reason?: string; pattern?: string }>((resolve) => {
    const onAbort = () => resolve({ decision: "deny", reason: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
    approvals.set(request.id, {
      request,
      owner: runner,
      resolve: (d) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(d);
      },
    });
    syncWaiting(runner);
    emit({ type: "approval_request", request });
  });
  approvals.delete(request.id);
  log.info("approval answered", { sessionId: runner.id, tool: tool.name, decision: decision.decision, ms: Date.now() - request.createdAt, mode: s.permissionMode });
  emit({ type: "approval_resolved", sessionId: runner.rootId, id: request.id });
  syncWaiting(runner);

  if (decision.decision === "deny") {
    if (decision.reason === "aborted") return { block: true, reason: "Operation aborted by the user." };
    return {
      block: true,
      reason: `The user denied this tool call.${decision.reason ? ` User's note: ${decision.reason}` : ""} Do not retry the same call; adjust your approach or ask the user how to proceed.`,
    };
  }
  // The reviewer reads what the user approved by hand: the same kind of action again is authorized.
  const gate = runner.root().gate;
  gate.approved = [...gate.approved, describeAction(tool, ctx.args, s.cwd).split("\n").slice(1).join("\n").slice(0, 600)].slice(-20);
  const pattern = (decision.pattern ?? perm.suggestion ?? "").trim();
  // A rule that lets any command through (`bash`, `rm`, `python3`, …) is never saved.
  if (decision.decision === "allow_always" && pattern && !(perm.kind === "bash" && isBroadEntry(pattern))) {
    const settings = store.getSettings();
    const key = perm.kind === "bash" ? "bashWhitelist" : "toolWhitelist";
    if (!settings[key].includes(pattern)) {
      store.saveSettings({ [key]: [...settings[key], pattern] });
      log.info("allow rule saved", { kind: perm.kind, pattern });
    }
  }
  return undefined;
}
