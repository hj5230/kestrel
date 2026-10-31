// Sessions and what runs in them: create, update, fork, merge, export, chat turns, and answers to the agent.
import fs from "node:fs";
import type { FileAttachment, SessionInfo } from "../../shared/protocol";
import { dropRunner, getRunner, peekRunner, respondApproval, respondQuestion, sessionDetail } from "../agent/runner";
import { collectInstructions } from "../agent/prompt";
import * as store from "../db";
import { collapseHome, expandHome } from "../env";
import { emit } from "../hub";
import { st } from "../i18n";
import { mcpStatuses } from "../mcp";
import { createSession, exportMarkdown, forkSession } from "../sessions";
import { mergeSession } from "../merge";
import { discoverSkills } from "../skills";
import { removeSessionUploads } from "../uploads";
import type { Handler } from "./types";
import { appInfo } from "../app-info";

export const sessionHandlers: Record<string, Handler> = {
  "sessions.list": ({ archived } = {}) => store.listSessions({ archived }),
  "sessions.get": ({ id }) => sessionDetail(id),
  "sessions.create": (input: Partial<SessionInfo>) => {
    const s = createSession(input);
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.update": ({ id, patch }: { id: string; patch: Partial<SessionInfo> }) => {
    if (patch.cwd) {
      patch.cwd = expandHome(patch.cwd);
      if (!fs.existsSync(patch.cwd)) throw new Error(st("dirNotFound", { path: patch.cwd }));
    }
    const allowed: (keyof SessionInfo)[] = ["title", "cwd", "providerId", "modelId", "thinking", "permissionMode", "pinned", "archived"];
    const clean: Partial<SessionInfo> = {};
    for (const k of allowed) if (k in patch) (clean as any)[k] = (patch as any)[k];
    store.updateSession(id, clean);
    const s = store.getSession(id)!;
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.delete": ({ id }) => {
    dropRunner(id);
    const deleted = store.deleteSession(id);
    for (const sessionId of deleted) removeSessionUploads(appInfo().dataDir, sessionId);
    emit({ type: "session_deleted", id });
    return true;
  },
  "sessions.fork": ({ id, seq }) => {
    const s = forkSession(id, seq, appInfo().dataDir);
    emit({ type: "session_updated", session: s });
    return s;
  },
  "sessions.merge": async ({ id, into, instructions }) => {
    const { source, target } = await mergeSession(id, into, instructions?.trim() || undefined);
    emit({ type: "session_updated", session: source });
    emit({ type: "session_updated", session: target });
    return target;
  },
  "sessions.export": ({ id }) => exportMarkdown(id),
  // One stored message per line, as the session's own record (no rendering), for pasting into other tools.
  "sessions.jsonl": ({ id }) => {
    if (!store.getSession(id)) throw new Error(st("sessionNotFound"));
    return store.loadMessages(id).map((m) => JSON.stringify({ seq: m.seq, ...m.message })).join("\n");
  },
  "sessions.contextBreakdown": ({ id }) => getRunner(id).contextBreakdown(),
  "sessions.search": ({ query, limit }) => store.searchMessages(query, limit ?? 40),
  "sessions.context": ({ id }) => {
    const s = store.getSession(id);
    if (!s) throw new Error(st("sessionNotFound"));
    return {
      instructions: collectInstructions(s.cwd).map((f) => ({ path: collapseHome(f.path), scope: f.scope, chars: f.content.length })),
      skills: discoverSkills(s.cwd).length,
      mcp: mcpStatuses().filter((m) => m.state === "connected").map((m) => ({ name: m.name, tools: m.tools.length })),
    };
  },
  "chat.send": async ({ sessionId, text, images, files, mode }: { sessionId: string; text: string; images?: any[]; files?: FileAttachment[]; mode?: "auto" | "steer" | "followUp" }) => {
    await getRunner(sessionId).send(text, images ?? [], files ?? [], mode ?? "auto");
    return true;
  },
  "chat.abort": ({ sessionId }) => {
    peekRunner(sessionId)?.abort();
    return true;
  },
  "chat.retry": async ({ sessionId }) => {
    await getRunner(sessionId).retry();
    return true;
  },
  "chat.edit": async ({ sessionId, seq, text, images, files }: { sessionId: string; seq: number; text: string; images?: any[]; files?: FileAttachment[] }) => {
    await getRunner(sessionId).editAndResend(seq, text, images ?? [], files ?? []);
    return true;
  },
  "chat.compact": async ({ sessionId, instructions }) => {
    await getRunner(sessionId).manualCompact(instructions);
    return true;
  },
  "chat.cancelQueued": ({ sessionId, id }) => {
    peekRunner(sessionId)?.cancelQueued(id);
    return true;
  },
  "approvals.respond": ({ id, decision, reason, pattern }) => {
    respondApproval(id, decision, reason, pattern);
    return true;
  },
  /** `answers: null` dismisses the question. */
  "questions.respond": ({ id, answers }) => {
    respondQuestion(id, answers ?? null);
    return true;
  },
};
