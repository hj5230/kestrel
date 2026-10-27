// The rules that make the agent actually reach for memory and ask_user. They live in the system prompt and,
// because the model reads a tool's description when deciding whether to call it, in the tool descriptions too.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSystemPrompt } from "./prompt";
import * as store from "../db";
import { createAskUserTool } from "../tools/ask";
import { memoryTools } from "../tools/memory";

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-prompt-"));
  store.openDb(dir, true);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const prompt = (opts: { subagent?: boolean } = {}) =>
  buildSystemPrompt({ cwd: "/tmp", permissionMode: "auto", modelName: "m", mcpServers: [], ...opts });

const ctx = (autoSave: boolean): any => ({ settings: () => ({ memoryAutoSave: autoSave }) });

describe("asking the user", () => {
  test("the main agent is told to ask with the tool instead of ending on a question", () => {
    const p = prompt();
    expect(p).toContain("Never end a reply with an open question");
    expect(p).toContain("call ask_user as the last action of the turn");
  });

  test("a subagent is not told to ask, since it cannot reach the user", () => {
    expect(prompt({ subagent: true })).not.toContain("ask_user");
  });

  test("the tool's own description says the same thing", () => {
    const d = createAskUserTool({ ask: async () => null } as any).description;
    expect(d).toContain("whenever you would end your reply");
    expect(d).toContain("last action of the turn");
  });
});

describe("memory", () => {
  test("unconfigured memory does not advertise tools or a note index", () => {
    expect(prompt()).toContain("Memory is unavailable");
    expect(prompt()).not.toContain("<memory_index>");
  });
  test("configured memory explains automatic tiered disclosure and background saving", () => {
    store.saveSettings({ memoryEmbedding: { api: "ollama", url: "http://localhost:1/api/embed", model: "e", apiKey: "" }, memoryReranker: { url: "http://localhost:2/v1/rerank", model: "r", apiKey: "" } });
    expect(prompt()).toContain("full notes first, then titles");
    expect(prompt()).toContain("durable background process");
    expect(prompt()).not.toContain("<memory_index>");
  });
  test("auto-save off preserves explicit-only saving in prompt and tools", () => {
    store.saveSettings({ memoryAutoSave: false });
    expect(prompt()).toContain("only when the user explicitly asks");
    expect(memoryTools(ctx(false), { readOnly: false }).find((t) => t.name === "memory_write")!.description).toContain("only when the user explicitly asks");
  });
  test("read is batched with required explicit ids; subagents cannot write", () => {
    const tools = memoryTools(ctx(true), { readOnly: true });
    expect(tools.map((t) => t.name)).toEqual(["memory_search", "memory_read"]);
    expect((tools[1].parameters as any).required).toEqual(["ids"]);
  });
});
