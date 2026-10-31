// Forking and merging against a scripted summarizer: what gets summarized, where the note lands, and that the
// merged session is archived rather than deleted.
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatMessage } from "../shared/protocol";
import * as store from "./db";
import { mergeSession } from "./merge";
import { createSession, forkSession } from "./sessions";

let server: ReturnType<typeof Bun.serve>;
let project: string;
const prompts: string[] = [];

beforeAll(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-merge-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-merge-proj-")));
  store.openDb(dataDir, true);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      prompts.push(JSON.stringify(body.messages));
      return Response.json({ id: "s", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "BRANCH SUMMARY" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    },
  });
  store.upsertProvider({ id: "mock", kind: "openai-compatible", name: "mock", baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "x", headers: {}, enabled: true, createdAt: Date.now() });
  store.upsertModel({ providerId: "mock", id: "m", name: "m", contextWindow: 100000, maxTokens: 4096, reasoning: false, vision: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, enabled: true });
});

afterAll(() => server.stop(true));

const user = (text: string): ChatMessage => ({ role: "user", content: text, timestamp: Date.now() });
const reply = (text: string): ChatMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  provider: "mock",
  model: "m",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: Date.now(),
});

function session(...messages: ChatMessage[]) {
  const s = createSession({ cwd: project, providerId: "mock", modelId: "m", title: "Main" });
  for (const m of messages) store.appendMessage(s.id, m);
  return s;
}

test("a fork is untitled, points at its source, and merges back only what happened after the fork", async () => {
  const main = session(user("shared question"), reply("shared answer"));
  const fork = forkSession(main.id, 1);
  expect(fork.title).toBe("");
  expect(fork.forkOf).toBe(main.id);
  expect(fork.forkSeq).toBe(1);
  store.appendMessage(fork.id, user("try the branch idea"));
  store.appendMessage(fork.id, reply("branch result"));

  prompts.length = 0;
  const { source, target } = await mergeSession(fork.id, main.id);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("try the branch idea");
  expect(prompts[0]).not.toContain("shared question");

  const note = store.loadMessages(main.id).at(-1)!.message;
  expect(note.role).toBe("user");
  expect((note as any).merge).toMatchObject({ sessionId: fork.id, messages: 2, summary: "BRANCH SUMMARY" });
  expect(String((note as any).content)).toContain("BRANCH SUMMARY");
  expect(target.messageCount).toBe(3);

  expect(source.archived).toBe(true);
  expect(source.mergedInto).toBe(main.id);
  expect(store.getSession(fork.id)).not.toBeNull();
});

test("a session merged anywhere else is summarized whole", async () => {
  const a = session(user("alpha question"), reply("alpha answer"));
  const b = session(user("beta question"));
  prompts.length = 0;
  await mergeSession(a.id, b.id);
  expect(prompts[0]).toContain("alpha question");
  expect(prompts[0]).toContain("alpha answer");
});

test("nothing new, or merging into itself, is refused and changes nothing", async () => {
  const main = session(user("q"), reply("a"));
  const fork = forkSession(main.id, 1);
  await expect(mergeSession(fork.id, main.id)).rejects.toThrow();
  await expect(mergeSession(main.id, main.id)).rejects.toThrow();
  expect(store.getSession(fork.id)!.archived).toBe(false);
  expect(store.loadMessages(main.id)).toHaveLength(2);
});
