// Approvals and questions waiting for the user, by id, with the runner that asked so an abort can answer them.
import type { ApprovalDecision, ApprovalRequest, QuestionAnswer, QuestionRequest } from "../../shared/protocol";
import { st } from "../i18n";
import type { SessionRunner } from "./session-runner";
import { claimQuestion, getQuestion, listQuestions, finishQuestion } from "../db/questions";
import { peekRunner } from "./runner";
import * as store from "../db";
import { emit } from "../hub";
import { appendStopMarker } from "./stop-marker";
import { sanitizeAnswers } from "../tools/ask";
import { answerRecovered } from "./question-recovery";

export interface PendingApproval {
  request: ApprovalRequest;
  resolve: (d: { decision: ApprovalDecision; reason?: string; pattern?: string }) => void;
  owner: SessionRunner;
}

export const approvals = new Map<string, PendingApproval>();

export interface PendingQuestion {
  request: QuestionRequest;
  resolve: (answers: QuestionAnswer[] | null) => void;
  owner: SessionRunner;
}

export const pendingQuestions = new Map<string, PendingQuestion>();

export function respondApproval(id: string, decision: ApprovalDecision, reason?: string, pattern?: string) {
  const p = approvals.get(id);
  if (!p) throw new Error(st("approvalExpired"));
  p.resolve({ decision, reason, pattern });
}

/** A recovered wait cannot accept a fresh prompt or retry until its questions are answered or stopped. */
export function assertNoRecoveredQuestions(sessionId: string) {
  if (listQuestions(sessionId).some((q) => !pendingQuestions.has(q.request.id))) throw new Error(st("sessionBusy"));
}

export function cancelRecoveredQuestions(sessionId: string) {
  const questions = listQuestions(sessionId);
  for (const q of questions) {
    if (pendingQuestions.has(q.request.id)) continue;
    const result = { role: "toolResult" as const, toolCallId: q.request.toolCallId, toolName: "ask_user", content: [{ type: "text" as const, text: "Operation aborted by the user." }], details: { title: q.request.title, questions: q.request.questions, answers: null }, isError: true, timestamp: Date.now() };
    store.db.transaction(() => { store.appendMessage(q.ownerId, result); finishQuestion(q.request.id); })();
    emit({ type: "question_resolved", sessionId, id: q.request.id });
  }
  if (questions.length) appendStopMarker(sessionId, store.loadMessages(sessionId).length);
  store.updateSession(sessionId, { status: "idle" });
  const session = store.getSession(sessionId);
  if (session) emit({ type: "session_updated", session });
  emit({ type: "messages_reset", sessionId });
}

/** `null` dismisses the question. */
export async function respondQuestion(id: string, answers: QuestionAnswer[] | null) {
  const q = getQuestion(id);
  if (!q) throw new Error(st("questionExpired"));
  const live = peekRunner(q.request.sessionId);
  if (!pendingQuestions.has(id) && q.state === "pending" && (live?.busy || live?.runPromise)) throw new Error(st("sessionBusy"));
  const clean = answers && sanitizeAnswers(q.request.questions, answers);
  if (!claimQuestion(id, clean)) return;
  const p = pendingQuestions.get(id);
  if (p) p.resolve(clean);
  else await answerRecovered(q, clean);
}
