// web_search is Tavily-backed and only offered to the model while a key is configured. A scripted
// model calls it against a stubbed Tavily endpoint: no key means no tool, a key means the request
// carries it and the results come back as numbered text, and an API error reaches the model.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRunner } from "./agent/runner";
import * as store from "./db";
import { createSession } from "./sessions";

let server: ReturnType<typeof Bun.serve>;
let project: string;
const realFetch = globalThis.fetch;
const toolLists: string[][] = [];
const tavilyCalls: { auth: string | null; body: any }[] = [];
let tavilyReply: () => Response;

function sse(chunks: any[]) {
  return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}
const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-web-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-web-proj-")));
  store.openDb(dataDir, true);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      if (!body.stream) {
        return Response.json({ id: "t", object: "chat.completion", created: 1, model: "agent", choices: [{ index: 0, message: { role: "assistant", content: "A title" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      const names: string[] = (body.tools ?? []).map((t: any) => t.function.name);
      toolLists.push(names);
      const results = body.messages.filter((m: any) => m.role === "tool");
      if (!results.length && names.includes("web_search")) {
        const args = JSON.stringify({ query: "kestrel agent", limit: 2 });
        return sse([chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_ws", type: "function", function: { name: "web_search", arguments: args } }] }), chunk({}, "tool_calls")]);
      }
      const seen = results.length ? "I saw:\n" + results[0].content : "no search tool";
      return sse([chunk({ role: "assistant", content: seen }), chunk({}, "stop")]);
    },
  });
  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  store.upsertModel({ providerId: "mock", id: "agent", name: "agent", contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
  globalThis.fetch = Object.assign(
    async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : (input.href ?? input.url);
      if (url !== "https://api.tavily.com/search") return realFetch(input, init);
      tavilyCalls.push({ auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(init.body) });
      return tavilyReply();
    },
    { preconnect: realFetch.preconnect },
  ) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  server.stop(true);
});

beforeEach(() => {
  toolLists.length = 0;
  tavilyCalls.length = 0;
  store.saveSettings({ tavilyApiKey: "" });
});

async function run() {
  const info = createSession({ cwd: project, providerId: "mock", modelId: "agent", permissionMode: "auto" });
  await getRunner(info.id).sendAndWait("go");
  const msgs = store.loadMessages(info.id).map((m) => m.message as any);
  const result = msgs.find((m) => m.role === "toolResult");
  return {
    toolText: result?.content.map((c: any) => c.text).join("") as string | undefined,
    isError: result?.isError as boolean | undefined,
    details: result?.details,
    finalText: msgs.filter((m) => m.role === "assistant").pop().content.map((c: any) => c.text ?? "").join("") as string,
  };
}

describe("web_search", () => {
  test("is not offered to the model without a Tavily key", async () => {
    const r = await run();
    expect(toolLists[0]).toContain("web_fetch");
    expect(toolLists[0]).not.toContain("web_search");
    expect(r.finalText).toContain("no search tool");
    expect(tavilyCalls).toEqual([]);
  }, 60000);

  test("a blank key counts as no key", async () => {
    store.saveSettings({ tavilyApiKey: "   " });
    await run();
    expect(toolLists[0]).not.toContain("web_search");
  }, 60000);

  test("with a key the model gets the tool and the results come back as text", async () => {
    store.saveSettings({ tavilyApiKey: " tvly-test " });
    tavilyReply = () =>
      Response.json({
        results: [
          { title: "Kestrel  docs", url: "https://example.com/a", content: "First\nresult   body", score: 0.9 },
          { title: "Second", url: "https://example.com/b", content: "x".repeat(900), score: 0.5 },
          { title: "No link", content: "dropped" },
        ],
      });
    const r = await run();
    expect(toolLists[0]).toContain("web_search");
    expect(tavilyCalls.length).toBe(1);
    expect(tavilyCalls[0].auth).toBe("Bearer tvly-test");
    expect(tavilyCalls[0].body).toMatchObject({ query: "kestrel agent", max_results: 2 });
    expect(r.isError).toBeFalsy();
    expect(r.toolText).toBe(`1. Kestrel docs\n   https://example.com/a\n   First result body\n\n2. Second\n   https://example.com/b\n   ${"x".repeat(500)}`);
    expect(r.details.results.map((x: any) => x.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(r.finalText).toContain(r.toolText!);
  }, 60000);

  test("an API error reaches the model without leaking the key", async () => {
    store.saveSettings({ tavilyApiKey: "tvly-secret" });
    tavilyReply = () => Response.json({ detail: { error: "Unauthorized: missing or invalid API key." } }, { status: 401 });
    const r = await run();
    expect(r.isError).toBe(true);
    expect(r.toolText).toBe("Tavily search failed (HTTP 401): Unauthorized: missing or invalid API key.");
    expect(r.toolText).not.toContain("tvly-secret");
  }, 60000);

  test("an empty result list says so", async () => {
    store.saveSettings({ tavilyApiKey: "tvly-test" });
    tavilyReply = () => Response.json({ results: [] });
    const r = await run();
    expect(r.toolText).toBe("No results.");
  }, 60000);
});
