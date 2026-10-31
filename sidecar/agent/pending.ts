// Approvals and questions waiting for the user, by id, with the runner that asked so an abort can answer them.
import type { ApprovalDecision, ApprovalRequest, QuestionAnswer, QuestionRequest } from "../../shared/protocol";
import { st } from "../i18n";
import type { SessionRunner } from "./session-runner";

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

/** `null` dismisses the question. */
export function respondQuestion(id: string, answers: QuestionAnswer[] | null) {
  const p = pendingQuestions.get(id);
  if (!p) throw new Error(st("questionExpired"));
  p.resolve(answers);
}
