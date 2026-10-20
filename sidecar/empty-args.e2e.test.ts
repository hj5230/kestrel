// A gateway that drops the arguments of parallel tool calls (every call arrives with `arguments: ""`).
// The model must be told what happened, and a later single call with real arguments must work.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRunner } from "./agent/runner";
import * as store from "./db";
import { createSession } from "./sessions";
import { createReadTool } from "./tools/fs-tools";
import { withEmptyArgsHint } from "./tools/empty-args";

let server: ReturnType<typeof Bun.serve>;
let project: string;

const sse = (chunks: any[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const call = (index: number, id: string, args: string) => ({ index, id, type: "function", function: { name: "read", arguments: args } });

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-empty-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-empty-proj-")));
  fs.writeFileSync(path.join(project, "note.txt"), "hello from the note\n");
  store.openDb(dataDir, true);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      if (!body.stream) {
        return Response.json({ id: "t", object: "chat.completion", created: 1, model: "agent", choices: [{ index: 0, message: { role: "assistant", content: "A title" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      const results = body.messages.filter((m: any) => m.role === "tool").length;
      // turn 1: two parallel calls whose arguments the gateway lost; turn 2: one call, alone, with its arguments
      if (results === 0) return sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", ""), call(1, "call_b", "")] }), chunk({}, "tool_calls")]);
      if (results === 2) return sse([chunk({ role: "assistant", tool_calls: [call(0, "call_c", JSON.stringify({ path: path.join(project, "note.txt") }))] }), chunk({}, "tool_calls")]);
      return sse([chunk({ role: "assistant", content: "done" }), chunk({}, "stop")]);
    },
  });
  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  store.upsertModel({ providerId: "mock", id: "agent", name: "agent", contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
});

afterAll(() => server.stop(true));

describe("tool calls that arrive without arguments", () => {
  test("the model is told the arguments were lost and to call one tool at a time", async () => {
    const info = createSession({ cwd: project, providerId: "mock", modelId: "agent", permissionMode: "auto" });
    await getRunner(info.id).sendAndWait("read the note");
    const results = store
      .loadMessages(info.id)
      .map((m) => m.message as any)
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ error: !!m.isError, text: m.content.map((c: any) => c.text ?? "").join("") }));
    expect(results.length).toBe(3);
    for (const r of results.slice(0, 2)) {
      expect(r.error).toBe(true);
      expect(r.text).toContain("arrived with no arguments");
      expect(r.text).toContain("needs: path");
      expect(r.text).toContain("one tool call per turn");
      expect(r.text).not.toContain("Validation failed");
    }
    expect(results[2]).toEqual({ error: false, text: expect.stringContaining("hello from the note") });
  }, 60000);
});

describe("withEmptyArgsHint", () => {
  const ctx: any = { cwd: () => "/", readFiles: new Map() };

  test("only empty arguments are intercepted", () => {
    const tool = withEmptyArgsHint(createReadTool(ctx));
    expect(() => tool.prepareArguments!({})).toThrow("needs: path");
    const args = { path: "/x" };
    expect(tool.prepareArguments!(args)).toBe(args);
  });

  test("a tool with nothing required is left alone, and an existing prepareArguments still runs", () => {
    const optional: any = { name: "t", parameters: { type: "object", properties: { a: { type: "string" } } } };
    expect(withEmptyArgsHint(optional)).toBe(optional);
    const custom: any = { name: "u", parameters: { type: "object", required: ["a"] }, prepareArguments: (a: any) => ({ ...a, fixed: true }) };
    expect(withEmptyArgsHint(custom).prepareArguments!({ a: 1 })).toEqual({ a: 1, fixed: true });
  });
});
