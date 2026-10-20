// A scripted model calls ask_user; the test plays the user. Checks the whole path in the runner:
// the run blocks while a question is open, the answers reach the model as the tool result, and a
// dismissal or an abort lets the run go on without hanging.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AskDetails, QuestionAnswer, QuestionRequest, ServerEvent } from "../shared/protocol";
import { getRunner, respondQuestion, sessionDetail } from "./agent/runner";
import * as store from "./db";
import { subscribe } from "./hub";
import { createSession } from "./sessions";
import { formatAnswers, sanitizeAnswers } from "./tools/ask";

let server: ReturnType<typeof Bun.serve>;
let project: string;
const toolSchemas: any[] = [];

function sse(chunks: any[]) {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });

const ARGS = {
  title: "Before I start",
  questions: [
    { question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres", description: "needs a server", recommended: true }] },
    { question: "Which extras?", multiple: true, options: [{ label: "Tests" }, { label: "Docs" }, { label: "CI" }] },
  ],
};

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-ask-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-ask-proj-")));
  store.openDb(dataDir, true);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      if (!body.stream) {
        return Response.json({ id: "t", object: "chat.completion", created: 1, model: "agent", choices: [{ index: 0, message: { role: "assistant", content: "A title" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      toolSchemas.push(body.tools);
      const results = body.messages.filter((m: any) => m.role === "tool");
      if (!results.length) {
        return sse([
          chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_ask", type: "function", function: { name: "ask_user", arguments: JSON.stringify(ARGS) } }] }),
          chunk({}, "tool_calls"),
        ]);
      }
      return sse([chunk({ role: "assistant", content: "I saw:\n" + results[0].content }), chunk({}, "stop")]);
    },
  });
  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  store.upsertModel({ providerId: "mock", id: "agent", name: "agent", contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
});

afterAll(() => server.stop(true));

/** Runs a session; `answer` plays the user for the first question that opens. */
async function run(answer: (q: QuestionRequest, sessionId: string) => void) {
  const info = createSession({ cwd: project, providerId: "mock", modelId: "agent", permissionMode: "auto" });
  const asked: QuestionRequest[] = [];
  const resolved: string[] = [];
  const statuses: string[] = [];
  const off = subscribe((e: ServerEvent) => {
    if (e.type === "question_request" && e.request.sessionId === info.id) {
      asked.push(e.request);
      // the session reports it is waiting while the question is open
      statuses.push(store.getSession(info.id)!.status);
      expect(sessionDetail(info.id).questions.map((q) => q.id)).toEqual([e.request.id]);
      setTimeout(() => answer(e.request, info.id), 20);
    }
    if (e.type === "question_resolved" && e.sessionId === info.id) resolved.push(e.id);
  });
  try {
    await getRunner(info.id).sendAndWait("go");
  } finally {
    off();
  }
  const msgs = store.loadMessages(info.id).map((m) => m.message as any);
  const result = msgs.find((m) => m.role === "toolResult");
  const final = msgs.filter((m) => m.role === "assistant").pop();
  return {
    info,
    asked,
    resolved,
    statuses,
    details: result?.details as AskDetails,
    toolText: result?.content.map((c: any) => c.text).join("") as string,
    finalText: final.content.map((c: any) => c.text ?? "").join(""),
    status: store.getSession(info.id)!.status,
  };
}

describe("ask_user, end to end", () => {
  test("the run waits for the user, then the model reads the answers", async () => {
    const r = await run((q) => respondQuestion(q.id, [
      { questionId: "q1", optionIds: [q.questions[0].options[0].id] },
      { questionId: "q2", optionIds: ["1", "3"], other: "  and a changelog  " },
    ]));
    expect(r.asked.length).toBe(1);
    expect(r.statuses).toEqual(["waiting"]);
    expect(r.resolved).toEqual([r.asked[0].id]);
    expect(r.status).not.toBe("waiting");
    // the recommended option is listed first
    expect(r.asked[0].questions[0].options.map((o) => o.label)).toEqual(["Postgres", "SQLite"]);
    expect(r.toolText).toBe("Q: Which database?\nA: Postgres\n\nQ: Which extras?\nA: Tests; CI; Other: and a changelog");
    expect(r.finalText).toContain(r.toolText);
    // the transcript can show what was asked and answered
    expect(r.details.title).toBe("Before I start");
    expect(r.details.answers?.[1]).toEqual({ questionId: "q2", optionIds: ["1", "3"], other: "and a changelog" });
  }, 60000);

  test("dismissing lets the model carry on and tells it so", async () => {
    const r = await run((q) => respondQuestion(q.id, null));
    expect(r.details.answers).toBeNull();
    expect(r.toolText).toContain("dismissed");
    expect(r.finalText).toContain("dismissed");
    expect(r.status).not.toBe("waiting");
  }, 60000);

  test("aborting the run closes the open question", async () => {
    const info = createSession({ cwd: project, providerId: "mock", modelId: "agent", permissionMode: "auto" });
    let opened = "";
    const off = subscribe((e: ServerEvent) => {
      if (e.type === "question_request" && e.request.sessionId === info.id) {
        opened = e.request.id;
        setTimeout(() => getRunner(info.id).abort(), 20);
      }
    });
    await getRunner(info.id).sendAndWait("go");
    off();
    expect(opened).not.toBe("");
    expect(sessionDetail(info.id).questions).toEqual([]);
    expect(() => respondQuestion(opened, [])).toThrow();
  }, 60000);

  test("the main agent is offered the tool", () => {
    expect(toolSchemas[0].map((t: any) => t.function.name)).toContain("ask_user");
  });
});

describe("answers", () => {
  const qs = [
    { id: "q1", prompt: "One?", options: [{ id: "1", label: "A" }, { id: "2", label: "B" }] },
    { id: "q2", prompt: "Many?", allowMultiple: true, options: [{ id: "1", label: "X" }, { id: "2", label: "Y" }] },
  ];

  test("unknown ids are dropped and single choice keeps one pick", () => {
    const a = sanitizeAnswers(qs, [
      { questionId: "q1", optionIds: ["2", "1", "9"] },
      { questionId: "nope", optionIds: ["1"] },
    ] as QuestionAnswer[]);
    expect(a).toEqual([
      { questionId: "q1", optionIds: ["2"] },
      { questionId: "q2", optionIds: [] },
    ]);
  });

  test("a question left blank is reported as such", () => {
    expect(formatAnswers(qs, sanitizeAnswers(qs, []))).toBe("Q: One?\nA: (no answer)\n\nQ: Many?\nA: (no answer)");
  });

  test("garbage from a client does not throw", () => {
    expect(() => sanitizeAnswers(qs, "x" as any)).not.toThrow();
    expect(sanitizeAnswers(qs, [{ questionId: "q1", optionIds: "1" as any, other: 5 as any }])[0]).toEqual({ questionId: "q1", optionIds: [] });
  });
});
