// Complete a recovered ask_user without replaying the interrupted turn's side effects. Other dangling
// tool calls receive explicit interruption results; a lost subagent hands its answer back to the root.
import type { ChatMessage, QuestionAnswer, ToolResultMsg } from "../../shared/protocol";
import * as store from "../db";
import { finishQuestion, listQuestions, type SavedQuestion } from "../db/questions";
import { formatAnswers } from "../tools/ask";
import { emit } from "../hub";
import { getRunner } from "./runner";
import { start } from "./turn";

export function questionResult(q: SavedQuestion, answers: QuestionAnswer[] | null): ToolResultMsg {
  return {
    role: "toolResult", toolCallId: q.request.toolCallId, toolName: "ask_user",
    content: [{ type: "text", text: answers ? formatAnswers(q.request.questions, answers) : "The user dismissed the question. Continue without asking it again immediately." }],
    details: { title: q.request.title, questions: q.request.questions, answers }, isError: false, timestamp: Date.now(),
  };
}

function append(id: string, message: ChatMessage) {
  const stored = store.appendMessage(id, message);
  emit({ type: "message_appended", sessionId: id, stored });
}

/** Only repair calls with no result. Never run a command to discover whether it completed before a crash. */
export function repairInterruptedTools(id: string) {
  const messages = store.loadMessages(id);
  const done = new Set(messages.flatMap(({ message: m }) => m.role === "toolResult" ? [m.toolCallId] : []));
  for (const q of listQuestions(id)) if (q.ownerId === id) done.add(q.request.toolCallId);
  for (const { message: m } of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.content) {
      if (c.type !== "toolCall" || done.has(c.id)) continue;
      append(id, { role: "toolResult", toolCallId: c.id, toolName: c.name,
        content: [{ type: "text", text: "Interrupted by app restart. Execution outcome is unknown; check current state before repeating any side effects." }],
        isError: true, timestamp: Date.now() });
      done.add(c.id);
    }
  }
}

export async function answerRecovered(q: SavedQuestion, answers: QuestionAnswer[] | null) {
  const rootId = q.request.sessionId;
  const result = questionResult(q, answers);
  store.db.transaction(() => {
    const exists = store.loadMessages(q.ownerId).some(({ message: m }) => m.role === "toolResult" && m.toolCallId === q.request.toolCallId);
    if (!exists) append(q.ownerId, result);
    finishQuestion(q.request.id);
    if (!listQuestions(rootId).length) repairInterruptedTools(rootId);
    if (q.ownerId !== rootId) {
      // No subagent promise survives restart; close its root task before handing over the answer.
      repairInterruptedTools(rootId);
      append(rootId, { role: "user", content: `A subagent was interrupted by app restart. The user has now answered its question:\n${result.content.map((c) => c.type === "text" ? c.text : "").join("\n")}`, timestamp: Date.now() });
    }
  })();
  emit({ type: "question_resolved", sessionId: rootId, id: q.request.id });
  if (listQuestions(rootId).length) return;
  const runner = getRunner(rootId);
  runner.reloadFromDb();
  // Start returns immediately to the RPC caller; the normal lifecycle publishes subsequent progress.
  void start(runner, () => runner.agent.continue()).catch(() => {});
}
