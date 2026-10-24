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
  test("reading is framed as the first step, not an optional extra", () => {
    const p = prompt();
    expect(p).toContain("before your first reply or tool call");
    expect(p).toContain("a missed note is the costly mistake");
  });

  test("saving is a checkpoint before the final message when auto-save is on", () => {
    expect(prompt()).toContain("Before you send the final message of a turn");
    expect(prompt()).toContain("Don't wait to be asked");
  });

  test("with auto-save off, both the prompt and the tool say to save only when asked", () => {
    store.saveSettings({ memoryAutoSave: false });
    expect(prompt()).toContain("only when the user explicitly asks");
    expect(prompt()).not.toContain("Don't wait to be asked");
    const write = memoryTools(ctx(false), { readOnly: false }).find((t) => t.name === "memory_write")!;
    expect(write.description).toContain("only when the user explicitly asks");
    expect(write.description).not.toContain("don't wait to be asked");
  });

  test("with auto-save on, the write tool tells the model to save without being asked", () => {
    store.saveSettings({ memoryAutoSave: true });
    const write = memoryTools(ctx(true), { readOnly: false }).find((t) => t.name === "memory_write")!;
    expect(write.description).toContain("don't wait to be asked");
  });

  test("the read tool says when to open a note", () => {
    const read = memoryTools(ctx(true), { readOnly: true }).find((t) => t.name === "memory_read")!;
    expect(read.description).toContain("plausibly related");
  });
});
