// The memory tests' shared fixture: a fake embedding, rerank and chat server, a fresh store and notes folder
// for every test, and small helpers. Call useMemoryFixture() once at the top of a test file.
import { afterAll, beforeAll, beforeEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import * as store from "../db";
import { cancelMemoryWork } from "../memory-retrieval";
import { createSession } from "../sessions";

/** What the fake model server does next; tests set these, the fixture resets them before each test. */
export const mock = {
  mode: "ok",
  calls: [] as { path: string; body: any }[],
  notes: [] as any[],
  onRerank: null as (() => void) | null,
  onEmbed: null as ((req: Request) => Promise<void>) | null,
};

let server: ReturnType<typeof Bun.serve>;
let root: string;
let current: string;
const previousRoot = process.env.KESTREL_MEMORY_DIR;
export const temp = () => fs.mkdtempSync(path.join(root, "case-"));
export const input = (name = "tea", content = "The user likes jasmine tea.") => ({ topic: "preferences", name, type: "user" as const, description: `Preference: ${name}`, content });
export const query = "What tea would I enjoy?";
export const configure = () => store.saveSettings({ ...store.DEFAULT_SETTINGS, proxyMode: "none", autoCompact: false, memoryEmbedding: { api: "ollama", url: `http://127.0.0.1:${server.port}/embed`, model: "embedding", apiKey: "" }, memoryReranker: { url: `http://127.0.0.1:${server.port}/rerank`, model: "reranker", apiKey: "" } });
export const textOf = (m: any) => typeof m.content === "string" ? m.content : m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
export const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: Date.now() });

/** Registers the server, the per-test reset and the cleanup with the calling test file. */
export function useMemoryFixture() {
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-memory-test-"));
    server = Bun.serve({ port: 0, async fetch(req) {
      const route = new URL(req.url).pathname;
      const body: any = await req.json();
      mock.calls.push({ path: route, body });
      if (mock.mode === route) return new Response("unavailable", { status: 503 });
      if (route === "/embed") {
        const hook = mock.onEmbed; mock.onEmbed = null; await hook?.(req);
        if (mock.mode === "vectors") return Response.json({ embeddings: [[0, 0]] });
        const vectors = body.input.map((s: string) => /tea|茉莉|茶/.test(s) ? [1, 0, 0] : [0, 1, 0]);
        if (body.encoding_format) return Response.json({ data: vectors.map((embedding: number[], index: number) => ({ index, embedding })).reverse() });
        return Response.json({ embeddings: vectors });
      }
      if (route === "/rerank") {
        const hook = mock.onRerank; mock.onRerank = null; hook?.();
        if (mock.mode === "scores") return Response.json({ results: [{ index: 0, relevance_score: 2 }] });
        if (mock.mode === "duplicate") return Response.json({ results: body.documents.map(() => ({ index: 0, relevance_score: 0.5 })) });
        return Response.json({ results: body.documents.map((s: string, index: number) => ({ index, relevance_score: /tea|茉莉|茶/.test(s) ? 0.9 : 0.02 })).reverse() });
      }
      if (body.stream) {
        const chunk = (delta: any, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 1, model: "chat", choices: [{ index: 0, delta, finish_reason: finish }] });
        return new Response([chunk({ role: "assistant", content: "Answer using memory" }), chunk({}, "stop")].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      const extraction = body.messages?.some((m: any) => typeof m.content === "string" && m.content.includes("Extract cross-session memory"));
      return Response.json({ id: "x", object: "chat.completion", created: 1, model: "chat", choices: [{ index: 0, message: { role: "assistant", content: extraction ? JSON.stringify({ notes: mock.notes }) : "Tea" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
    } });
  });
  beforeEach(() => {
    current = temp();
    process.env.KESTREL_MEMORY_DIR = path.join(current, "notes");
    store.openDb(current, true);
    cancelMemoryWork();
    mock.calls = []; mock.mode = "ok"; mock.notes = []; mock.onRerank = null; mock.onEmbed = null;
    configure();
    store.upsertProvider({ id: "memory-mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "", headers: {}, enabled: true, createdAt: Date.now() });
    store.upsertModel({ providerId: "memory-mock", id: "chat", name: "chat", contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, enabled: true });
  });
  afterAll(() => { server.stop(true); if (previousRoot === undefined) delete process.env.KESTREL_MEMORY_DIR; else process.env.KESTREL_MEMORY_DIR = previousRoot; fs.rmSync(root, { recursive: true, force: true }); });
}

export const session = () => createSession({ cwd: current, providerId: "memory-mock", modelId: "chat", permissionMode: "auto" });
