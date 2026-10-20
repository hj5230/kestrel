// Side calls (title, compaction) run on the model chosen for them and are billed to it.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRunner } from "./agent/runner";
import * as store from "./db";
import { createSession } from "./sessions";

let server: ReturnType<typeof Bun.serve>;
let project: string;
/** Models that received a non-streaming request (title, compaction), in order. */
const sideCalls: string[] = [];

const sse = (chunks: any[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-side-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-side-proj-")));
  store.openDb(dataDir, true);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      if (body.stream) return sse([chunk({ role: "assistant", content: "hello there" }), chunk({}, "stop")]);
      sideCalls.push(body.model);
      const text = body.model === "cheap" ? "Cheap output" : "Expensive output";
      return Response.json({ id: "t", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
    },
  });
  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  for (const [id, price] of [["main", 3], ["cheap", 1]] as const) {
    store.upsertModel({ providerId: "mock", id, name: id, contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: price, output: price, cacheRead: 0, cacheWrite: 0 }, enabled: true });
  }
});

afterAll(() => server.stop(true));

const usage = () => {
  const db = new Database(store.dbPath, { readonly: true });
  try {
    return db.query("SELECT purpose, model_id AS model, input, output, cost FROM usage_events WHERE purpose IN ('title', 'compaction') ORDER BY id").all() as any[];
  } finally {
    db.close();
  }
};

test("title and compaction use their own models and are billed to them", async () => {
  store.saveSettings({ titleModel: "mock::cheap", compactModel: "mock::cheap" });
  const info = createSession({ cwd: project, providerId: "mock", modelId: "main", permissionMode: "auto" });
  const runner = getRunner(info.id);
  await runner.sendAndWait("first question");
  await runner.sendAndWait("second question");
  for (let i = 0; i < 50 && !store.getSession(info.id)?.title; i++) await Bun.sleep(50);
  expect(store.getSession(info.id)?.title).toBe("Cheap output");

  await runner.compact({ auto: false, full: true });
  expect(sideCalls).toEqual(["cheap", "cheap"]);
  const rows = usage();
  expect(rows.map((r) => [r.purpose, r.model])).toEqual([["title", "cheap"], ["compaction", "cheap"]]);
  // 1000 in + 100 out at $1 per million each
  expect(rows[1].cost).toBeCloseTo(0.0011, 6);
}, 30000);

test("with nothing chosen (or a removed provider) they fall back to the session's model", async () => {
  sideCalls.length = 0;
  store.saveSettings({ titleModel: "gone::x", compactModel: "" });
  const info = createSession({ cwd: project, providerId: "mock", modelId: "main", permissionMode: "auto" });
  const runner = getRunner(info.id);
  await runner.sendAndWait("hi");
  await runner.sendAndWait("again");
  for (let i = 0; i < 50 && !store.getSession(info.id)?.title; i++) await Bun.sleep(50);
  await runner.compact({ auto: false, full: true });
  expect(sideCalls).toEqual(["main", "main"]);
}, 30000);
