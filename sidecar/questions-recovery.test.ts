// Pending questions survive database reopen; answering a recovered call appends one result, not a replay.
import { expect, test } from "bun:test";
import { subscribe } from "./hub";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./db";
import { createSession } from "./sessions";
import { claimQuestion, getQuestion, listQuestions, recoverQuestions, saveQuestion } from "./db/questions";
import { respondQuestion, assertNoRecoveredQuestions, cancelRecoveredQuestions } from "./agent/pending";
import { getRunner, runners, sessionDetail } from "./agent/runner";
import type { AssistantMsg, QuestionRequest } from "../shared/protocol";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-question-restart-"));
  store.openDb(dir, true);
  const session = createSession({ cwd: dir });
  const req: QuestionRequest = { id: crypto.randomUUID(), sessionId: session.id, toolCallId: "ask-1", createdAt: Date.now(), questions: [{ id: "q1", prompt: "Pick?", options: [{ id: "1", label: "A" }, { id: "2", label: "B" }] }] };
  const msg: AssistantMsg = { role: "assistant", content: [{ type: "toolCall", id: "ask-1", name: "ask_user", arguments: {} }], stopReason: "toolUse", provider: "test", model: "test", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  store.appendMessage(session.id, { role: "user", content: "hello", timestamp: Date.now() });
  store.appendMessage(session.id, msg);
  saveQuestion(req, session.id);
  store.updateSession(session.id, { status: "waiting" });
  return { dir, session, req };
}

test("reopen preserves question identity and waiting state; interrupted claims become answerable", () => {
  const { dir, session, req } = fixture();
  claimQuestion(req.id, [{ questionId: "q1", optionIds: ["1"] }]);
  store.db.close();
  store.openDb(dir, true);
  expect(store.getSession(session.id)?.status).toBe("waiting");
  expect(sessionDetail(session.id).questions).toEqual([req]);
  expect(getQuestion(req.id)?.state).toBe("pending");
  expect(() => assertNoRecoveredQuestions(session.id)).toThrow();
  store.db.close();
});

test("duplicate answers do not duplicate tool results or start the interrupted tools again", async () => {
  const { session, req } = fixture();
  // Leave another recovered question pending so answering this one does not start a model request.
  saveQuestion({ ...req, id: "second", toolCallId: "ask-2" }, session.id);
  await respondQuestion(req.id, [{ questionId: "q1", optionIds: ["1"] }]);
  await respondQuestion(req.id, [{ questionId: "q1", optionIds: ["2"] }]);
  const messages = store.loadMessages(session.id);
  expect(messages).toHaveLength(3);
  const result = messages[2].message;
  expect(result.role).toBe("toolResult");
  if (result.role === "toolResult") expect(result.content).toEqual([{ type: "text", text: "Q: Pick?\nA: A" }]);
  expect(listQuestions(session.id)).toHaveLength(1);
  store.db.close();
});

test("answer after reopen continues with the tool result rather than replaying ask_user", async () => {
  const { dir, session, req } = fixture();
  let requests = 0;
  let received: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json();
    if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "Title" } }] });
    requests++;
    received = body.messages;
    const chunk = (delta: any, finish: string | null = null) => ({ id: "reply", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason: finish }] });
    return new Response([chunk({ role: "assistant", content: "Resumed with A" }), chunk({}, "stop")].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  store.upsertProvider({ id: "test", kind: "openai-compatible", name: "test", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "test", headers: {}, enabled: true, createdAt: 1 });
  store.upsertModel({ providerId: "test", id: "test", name: "test", contextWindow: 100000, maxTokens: 1000, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
  store.updateSession(session.id, { providerId: "test", modelId: "test", title: "Recovery" });
  store.db.close();
  store.openDb(dir, true);
  let finished = false;
  const off = subscribe((e) => { if (e.type === "run_finished" && e.sessionId === session.id) finished = true; });
  try {
    await respondQuestion(req.id, [{ questionId: "q1", optionIds: ["1"] }]);
    for (let i = 0; i < 200 && !finished; i++) await Bun.sleep(10);
    expect(finished).toBe(true);
    expect(requests).toBe(1);
    expect(received.some((m) => m.role === "tool" && m.content.includes("A: A"))).toBe(true);
    expect(store.getSession(session.id)?.status).toBe("idle");
    expect(store.loadMessages(session.id).filter(({ message: m }) => m.role === "toolResult")).toHaveLength(1);
  } finally { off(); server.stop(true); runners.clear(); store.db.close(); }
});

test("explicit stop closes recovered questions and reopening does not resurrect them", () => {
  const { session } = fixture();
  getRunner(session.id); // A context/details read may have created an idle runner.
  cancelRecoveredQuestions(session.id);
  recoverQuestions();
  expect(listQuestions(session.id)).toEqual([]);
  expect(store.getSession(session.id)?.status).toBe("idle");
  runners.clear();
  store.db.close();
});
