// The live runners, one per session that has been used since start, and the detail view of a session.
import type { SessionDetail } from "../../shared/protocol";
import * as store from "../db";
import { st } from "../i18n";
import { SessionRunner } from "./session-runner";
import { approvals } from "./pending";
import { listQuestions } from "../db/questions";

export const runners = new Map<string, SessionRunner>();

export function getRunner(id: string): SessionRunner {
  let r = runners.get(id);
  if (!r) {
    const info = store.getSession(id);
    if (!info) throw new Error(st("sessionNotFound"));
    r = new SessionRunner(info, null);
    runners.set(id, r);
  }
  return r;
}

export function peekRunner(id: string): SessionRunner | undefined {
  return runners.get(id);
}

export function dropRunner(id: string) {
  const r = runners.get(id);
  if (r) {
    r.abort();
    runners.delete(id);
  }
}

export function sessionDetail(id: string): SessionDetail {
  const info = store.getSession(id);
  if (!info) throw new Error(st("sessionNotFound"));
  const r = runners.get(id);
  return {
    session: info,
    messages: store.loadMessages(id),
    compactions: store.listCompactions(id),
    approvals: [...approvals.values()].filter((a) => a.request.sessionId === id).map((a) => a.request),
    questions: listQuestions(id).map((q) => q.request),
    streaming: r?.streaming ?? null,
    phase: r?.phase ?? null,
    runningTools: r?.runningTools ?? {},
    queued: r?.queued.map(({ id, text, mode, files }) => ({ id, text, mode, files })) ?? [],
  };
}

export { respondApproval, respondQuestion } from "./pending";
