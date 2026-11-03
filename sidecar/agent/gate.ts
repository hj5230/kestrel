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

/** What the reviewer reads: the user's words and the agent's tool calls, nothing else. */
export function reviewTranscript(runner: SessionRunner): string {
  const own = runner.agent.state.messages;
  if (!runner.parent) return buildTranscript(partsFromMessages(own));
  const rootParts = partsFromMessages(runner.root().agent.state.messages).filter((p) => p.role !== "tool_call");
  return buildTranscript([...rootParts, ...partsFromMessages(own, { firstUserIsTask: true })]);
}

/** Auto mode: the reviewer decides. Returns a block result, or null to let the call run; falls back to asking a person. */
export async function autoReview(runner: SessionRunner, tool: KestrelTool, args: unknown, perm: PermissionResult, signal?: AbortSignal): Promise<{ block: true; reason: string } | PermissionResult | null> {
  const gate = runner.root().gate;
  if (gate.paused) return { ...perm, action: "ask", note: { code: "review_paused" } };
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
      gate.consecutive = 0;
      return null;
    }
    gate.consecutive++;
    gate.total++;
    if (gate.consecutive < 3 && gate.total < 20) {
      return {
        block: true,
        reason:
          `Auto review blocked this action: ${r.reason} ` +
          "Treat this as a boundary, not an obstacle: do not retry it, reword it, split it into smaller steps or run it another way. " +
          "Pick a clearly safer approach that still serves the user's request, or ask the user how to proceed.",
      };
    }
    // Too many blocks: stop and hand this one to a person. Approving it resumes auto mode.
    gate.paused = true;
    gate.consecutive = 0;
    if (gate.total >= 20) gate.total = 0;
    return { ...perm, action: "ask", note: { code: "review_blocked", detail: r.reason } };
  } catch (e: any) {
    if (signal?.aborted) return { block: true, reason: "Operation aborted by the user." };
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
  if (perm.action === "deny") return { block: true, reason: perm.reason };

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
  emit({ type: "approval_resolved", sessionId: runner.rootId, id: request.id });
  syncWaiting(runner);

  if (decision.decision === "deny") {
    if (decision.reason === "aborted") return { block: true, reason: "Operation aborted by the user." };
    return {
      block: true,
      reason: `The user denied this tool call.${decision.reason ? ` User's note: ${decision.reason}` : ""} Do not retry the same call; adjust your approach or ask the user how to proceed.`,
    };
  }
  // A person approved something: auto mode picks up again.
  runner.root().gate = { ...runner.root().gate, paused: false, consecutive: 0 };
  const pattern = (decision.pattern ?? perm.suggestion ?? "").trim();
  // A rule that lets any command through (`bash`, `rm`, `python3`, …) is never saved.
  if (decision.decision === "allow_always" && pattern && !(perm.kind === "bash" && isBroadEntry(pattern))) {
    const settings = store.getSettings();
    const key = perm.kind === "bash" ? "bashWhitelist" : "toolWhitelist";
    if (!settings[key].includes(pattern)) store.saveSettings({ [key]: [...settings[key], pattern] });
  }
  return undefined;
}
