// Durable questions outlive the resolver that originally waited for them. Answers are claimed once and
// reconciled against stored tool results after restart, so a lost process is never treated as dismissal.
import type { QuestionAnswer, QuestionRequest } from "../../shared/protocol";
import { db } from "./connection";

export interface SavedQuestion {
  request: QuestionRequest;
  ownerId: string;
  state: "pending" | "answering" | "done";
  answers: QuestionAnswer[] | null;
}

function decode(row: any): SavedQuestion {
  return { request: JSON.parse(row.request), ownerId: row.owner_id, state: row.state, answers: row.answers ? JSON.parse(row.answers) : null };
}

export function saveQuestion(request: QuestionRequest, ownerId: string) {
  db.run("INSERT INTO pending_questions (id, session_id, owner_id, request, created_at) VALUES (?, ?, ?, ?, ?)",
    [request.id, request.sessionId, ownerId, JSON.stringify(request), request.createdAt]);
}

export function getQuestion(id: string): SavedQuestion | null {
  const row = db.query("SELECT * FROM pending_questions WHERE id = ?").get(id);
  return row ? decode(row) : null;
}

export function listQuestions(sessionId: string): SavedQuestion[] {
  return db.query("SELECT * FROM pending_questions WHERE session_id = ? AND state != 'done' ORDER BY created_at").all(sessionId).map(decode);
}

export function claimQuestion(id: string, answers: QuestionAnswer[] | null) {
  return db.run("UPDATE pending_questions SET state = 'answering', answers = ? WHERE id = ? AND state = 'pending'", [JSON.stringify(answers), id]).changes > 0;
}

export function finishQuestion(id: string) {
  db.run("UPDATE pending_questions SET state = 'done' WHERE id = ?", [id]);
}

export function finishQuestionTool(ownerId: string, toolCallId: string) {
  db.run("UPDATE pending_questions SET state = 'done' WHERE owner_id = ? AND json_extract(request, '$.toolCallId') = ?", [ownerId, toolCallId]);
}

export function recoverQuestions() {
  // A result already on disk wins over a stale request. Otherwise show the original question again.
  db.run(`UPDATE pending_questions SET state = 'done' WHERE EXISTS (
    SELECT 1 FROM messages m WHERE m.session_id = pending_questions.owner_id AND m.role = 'toolResult'
    AND json_extract(m.data, '$.toolCallId') = json_extract(pending_questions.request, '$.toolCallId'))`);
  db.run("UPDATE pending_questions SET state = 'pending' WHERE state = 'answering'");
  db.run("UPDATE sessions SET status = 'waiting' WHERE id IN (SELECT session_id FROM pending_questions WHERE state = 'pending')");
}
