// Runs real sessions against a scripted OpenAI-compatible server: one "agent" model that asks for
// shell commands, one "reviewer" model that answers ALLOW/BLOCK. Checks the whole auto-mode path in
// the runner: rules, review, deny-and-continue, the pause after repeated blocks, and fail-closed.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ApprovalRequest, ServerEvent } from "../shared/protocol";
import { getRunner, respondApproval } from "./agent/runner";
import * as store from "./db";
import { subscribe } from "./hub";
import { createSession } from "./sessions";

let server: ReturnType<typeof Bun.serve>;
let project: string;
let reviewerDown = false;
const reviewerSaw: string[] = [];

/** The agent model: requests the commands listed in the first user message ("run: a ;; b ;; c"), then says it is done. */
function agentReply(body: any) {
  const msgs: any[] = body.messages;
  const first = String(msgs.find((m) => m.role === "user")?.content ?? "");
  const commands = first.replace(/^run:\s*/, "").split(" ;; ");
  const done = msgs.filter((m) => m.role === "tool").length;
  return done < commands.length ? { tool: commands[done] } : { text: "finished" };
}

function sse(chunks: any[]) {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-e2e-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-e2e-proj-")));
  store.openDb(dataDir, true);

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      if (body.model === "reviewer") {
        if (reviewerDown) return new Response("boom", { status: 500 });
        const prompt = JSON.stringify(body.messages);
        reviewerSaw.push(prompt);
        const dangerous = prompt.includes("--force");
        const stage2 = prompt.includes("VERDICT");
        const text = !dangerous ? "ALLOW" : stage2 ? "Force push was not requested.\nVERDICT: BLOCK\nREASON: Nobody asked to rewrite history." : "BLOCK";
        return Response.json({ id: "r", object: "chat.completion", created: 1, model: "reviewer", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      if (!body.stream) {
        return Response.json({ id: "t", object: "chat.completion", created: 1, model: "agent", choices: [{ index: 0, message: { role: "assistant", content: "A title" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      const r = agentReply(body);
      if ("tool" in r) {
        return sse([
          chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2), type: "function", function: { name: "bash", arguments: JSON.stringify({ command: r.tool }) } }] }),
          chunk({}, "tool_calls"),
        ]);
      }
      return sse([chunk({ role: "assistant", content: r.text }), chunk({}, "stop")]);
    },
  });

  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  for (const id of ["agent", "reviewer"]) {
    store.upsertModel({ providerId: "mock", id, name: id, contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
  }
  store.saveSettings({ autoModel: "mock::reviewer", defaultPermissionMode: "auto" });
});

afterAll(() => server.stop(true));

/** Runs one session to the end; every approval request is answered with `answer`. */
async function session(commands: string[], answer: "allow_once" | "deny" = "deny") {
  const info = createSession({ cwd: project, providerId: "mock", modelId: "agent", permissionMode: "auto" });
  const asked: ApprovalRequest[] = [];
  const off = subscribe((e: ServerEvent) => {
    if (e.type === "approval_request" && e.request.sessionId === info.id) {
      asked.push(e.request);
      queueMicrotask(() => respondApproval(e.request.id, answer));
    }
  });
  try {
    await getRunner(info.id).sendAndWait("run: " + commands.join(" ;; "));
  } finally {
    off();
  }
  const results = store
    .loadMessages(info.id)
    .map((m) => m.message as any)
    .filter((m) => m.role === "toolResult")
    .map((m) => ({ error: !!m.isError, text: m.content.map((c: any) => c.text ?? "").join("") }));
  return { asked, results };
}

describe("auto mode, end to end", () => {
  test("rules decide the clear cases without bothering the reviewer or the user", async () => {
    reviewerSaw.length = 0;
    const { asked, results } = await session(["pwd", "cd . && ls", "mkdir -p made && touch made/x && rm -rf made"]);
    expect(asked).toEqual([]);
    expect(reviewerSaw.length).toBe(0);
    expect(results.map((r) => r.error)).toEqual([false, false, false]);
  }, 60000);

  test("the reviewer lets a harmless command through", async () => {
    reviewerSaw.length = 0;
    const { asked, results } = await session(["sleep 0"]);
    expect(reviewerSaw.length).toBe(1);
    expect(asked).toEqual([]);
    expect(results[0].error).toBe(false);
    // the review's tokens are billed to the review model
    const db = new Database(store.dbPath, { readonly: true });
    const rows = db.query("SELECT model_id AS model, input FROM usage_events WHERE purpose = 'review'").all() as any[];
    db.close();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({ model: "reviewer", input: 1 });
  }, 60000);

  test("an action the reviewer would block goes to the user with its reason, and does not run unless approved", async () => {
    const { asked, results } = await session(["git push --force origin main"], "deny");
    expect(asked.length).toBe(1);
    expect(asked[0].note?.code).toBe("review_blocked");
    expect(asked[0].note?.detail).toContain("Nobody asked");
    expect(results[0].error).toBe(true);
    expect(results[0].text).toContain("The user denied this tool call.");
  }, 60000);

  test("the reviewer only ever sees the user's words and the tool call", async () => {
    reviewerSaw.length = 0;
    await session(["git push --force origin main"]);
    const seen = reviewerSaw[0];
    expect(seen).toContain("[user] run: git push --force origin main");
    expect(seen).toContain("<action>");
    expect(seen).not.toContain("finished");
  }, 60000);

  test("every flagged action is the user's call, and the reviewer then sees what was approved", async () => {
    reviewerSaw.length = 0;
    const { asked } = await session(["git push --force a", "git push --force b"], "allow_once");
    expect(asked.map((a) => a.note?.code)).toEqual(["review_blocked", "review_blocked"]);
    expect(reviewerSaw.some((seen) => seen.includes("[the user approved this action by hand] bash: git push --force a"))).toBe(true);
  }, 60000);

  test("when the reviewer cannot be reached, a person is asked", async () => {
    reviewerDown = true;
    try {
      const { asked, results } = await session(["sleep 0"], "deny");
      expect(asked.length).toBe(1);
      expect(asked[0].note?.code).toBe("review_error");
      expect(results[0].error).toBe(true);
      expect(results[0].text).toContain("denied");
    } finally {
      reviewerDown = false;
    }
  }, 60000);

  test("credentials and critical deletes skip the reviewer and go straight to a person", async () => {
    reviewerSaw.length = 0;
    const { asked } = await session(["cat ~/.ssh/id_rsa", "rm -rf ~/Documents"], "deny");
    expect(reviewerSaw.length).toBe(0);
    expect(asked.map((a) => a.note?.code)).toEqual(["sensitive_read", "critical_delete"]);
  }, 60000);

  test("without a review model, unclear commands are simply asked", async () => {
    store.saveSettings({ autoModel: "" });
    try {
      const { asked } = await session(["sleep 0"], "deny");
      expect(asked.length).toBe(1);
      expect(asked[0].note ?? null).toBeNull();
    } finally {
      store.saveSettings({ autoModel: "mock::reviewer" });
    }
  }, 60000);
});
