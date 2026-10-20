import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshHistory, historyStatus, isHistoryKey, openHistoryDb, readHistory, searchHistory, setHistorySources, syncHistory } from "./index";
import * as store from "../db";
import { createReadSessionTool, createSearchSessionsTool } from "../tools/meta";
import { setHistoryHome } from "./sources";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-history-"));
const jl = (rows: any[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const put = (rel: string, rows: any[]) => {
  const f = path.join(home, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, jl(rows));
  return f;
};

const CLAUDE = "11111111-1111-4111-8111-111111111111";
const CODEX = "22222222-2222-4222-8222-222222222222";
const GUARD = "33333333-3333-4333-8333-333333333333";

const claudeUser = (text: any, extra: any = {}) => ({ type: "user", cwd: "/work/alpha", sessionId: CLAUDE, timestamp: "2026-10-01T10:00:00Z", message: { role: "user", content: text }, ...extra });
const claudeAsst = (blocks: any[]) => ({ type: "assistant", timestamp: "2026-10-01T10:00:05Z", message: { role: "assistant", content: blocks } });

beforeAll(() => {
  setHistoryHome(home);
  openHistoryDb(":memory:");
  setHistorySources(["claude-code", "codex", "cursor"]);

  put(`.claude/projects/-work-alpha/${CLAUDE}.jsonl`, [
    { type: "file-history-snapshot", messageId: "x" },
    claudeUser("How do I rotate the zebra credentials?"),
    claudeAsst([{ type: "thinking", thinking: "secret musings" }, { type: "text", text: "Use the rotate-zebra script." }, { type: "tool_use", name: "Bash", input: { command: "./rotate-zebra.sh --dry-run" } }]),
    claudeUser([{ type: "tool_result", content: "tool output mentioning quokka" }]),
    claudeUser("<local-command-caveat>ignore me narwhal</local-command-caveat>"),
    claudeUser("meta line pangolin", { isMeta: true }),
    { ...claudeAsst([{ type: "text", text: "sidechain walrus" }]), isSidechain: true },
    { type: "ai-title", aiTitle: "Rotating credentials", sessionId: CLAUDE },
  ]);
  put(`.claude/projects/-work-alpha/${CLAUDE}/subagents/agent-1.jsonl`, [claudeUser("subagent file should never be indexed ocelot")]);

  put(`.codex/sessions/2026/10/02/rollout-2026-10-02T09-00-00-${CODEX}.jsonl`, [
    { type: "session_meta", timestamp: "2026-10-02T09:00:00Z", payload: { id: CODEX, cwd: "/work/beta", thread_source: "user", timestamp: "2026-10-02T09:00:00Z" } },
    { type: "response_item", timestamp: "2026-10-02T09:00:01Z", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "developer instructions marmot" }] } },
    { type: "response_item", timestamp: "2026-10-02T09:00:02Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd /work/beta</environment_context>" }] } },
    { type: "response_item", timestamp: "2026-10-02T09:00:03Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Why does the flamingo parser drop trailing commas?" }] } },
    { type: "response_item", timestamp: "2026-10-02T09:00:04Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Because the tokenizer stops at the last comma." }] } },
    { type: "response_item", timestamp: "2026-10-02T09:00:05Z", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["grep", "flamingo"] }) } },
  ]);
  put(`.codex/sessions/2026/10/02/rollout-2026-10-02T09-05-00-${GUARD}.jsonl`, [
    { type: "session_meta", payload: { id: GUARD, cwd: "/work/beta", thread_source: "guardian_review" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "guardian review of axolotl action" }] } },
  ]);
  put(".codex/session_index.jsonl", [{ id: CODEX, thread_name: "Parser trailing commas", updated_at: "2026-10-02T09:30:00Z" }]);

  put(".cursor/projects/-work-gamma/agent-transcripts/44444444-4444-4444-8444-444444444444/44444444-4444-4444-8444-444444444444.jsonl", [
    { role: "user", message: { content: [{ type: "text", text: "<attached_files>junk</attached_files>\n<user_query>\nWhy is the capybara build slow?\n</user_query>" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "Probably the cache is cold." }] } },
  ]);
});

describe("indexing other apps' sessions", () => {
  test("reads each app's own format, and only real conversation", async () => {
    await syncHistory();
    const status = historyStatus();
    expect(status.sources.map((s) => [s.id, s.sessions])).toEqual([["claude-code", 1], ["codex", 1], ["cursor", 1]]);
    // noise is not searchable: thinking, tool output, injected context, sidechains, helper threads, subagent files
    for (const q of ["musings", "quokka", "narwhal", "pangolin", "walrus", "marmot", "axolotl", "ocelot", "junk"]) expect(searchHistory(q)).toEqual([]);
  });

  test("finds sessions with the title, project and a snippet", () => {
    const [hit] = searchHistory("zebra credentials");
    expect(hit.key).toBe(`claude-code:${CLAUDE}`);
    expect(hit.title).toBe("Rotating credentials");
    expect(hit.cwd).toBe("/work/alpha");
    expect(hit.matches[0].snippet).toContain("«");
    expect(searchHistory("flamingo")[0].title).toBe("Parser trailing commas");
    expect(searchHistory("capybara")[0].key.startsWith("cursor:")).toBe(true);
  });

  test("filters by app and project, handles short terms and title-only hits", () => {
    expect(searchHistory("zebra", { source: "codex" })).toEqual([]);
    expect(searchHistory("flamingo", { project: "beta" }).length).toBe(1);
    expect(searchHistory("flamingo", { project: "alpha" })).toEqual([]);
    expect(searchHistory("rotating").map((h) => h.matches[0].role)).toEqual(["title"]);
    expect(searchHistory("zb").length).toBe(0);
    expect(searchHistory("Pa").length).toBeGreaterThan(0); // two-letter terms fall back to a scan
  });

  test("reads a session back with seq numbers and tool calls", () => {
    const text = readHistory(`claude-code:${CLAUDE}`);
    expect(text).toContain("app: Claude Code");
    expect(text).toContain("## User #0\nHow do I rotate the zebra credentials?");
    expect(text).toContain("## Assistant #1\nUse the rotate-zebra script.");
    expect(text).toContain("[tool Bash: ./rotate-zebra.sh --dry-run]");
    expect(text).not.toContain("musings");
    expect(readHistory(`claude-code:${CLAUDE}`, 1)).not.toContain("How do I rotate");
    expect(readHistory(`codex:${CODEX}`)).toContain("[tool shell:");
    expect(() => readHistory("claude-code:nope")).toThrow();
    expect(isHistoryKey("codex:abc")).toBe(true);
    expect(isHistoryKey("0b2f1c")).toBe(false);
  });

  test("a pass after new lines only adds those", async () => {
    const f = path.join(home, `.claude/projects/-work-alpha/${CLAUDE}.jsonl`);
    fs.appendFileSync(f, jl([claudeUser("Also check the okapi rollout"), claudeAsst([{ type: "text", text: "Done with okapi." }])]));
    await syncHistory();
    const [hit] = searchHistory("okapi");
    expect(hit.key).toBe(`claude-code:${CLAUDE}`);
    expect(searchHistory("zebra").length).toBe(1); // the earlier messages are still there once
    expect(historyStatus().sources[0].messages).toBe(4);
  });

  test("a half-written last line waits for the next pass", async () => {
    const f = path.join(home, `.claude/projects/-work-alpha/${CLAUDE}.jsonl`);
    const line = JSON.stringify(claudeUser("A late message about the tapir"));
    fs.appendFileSync(f, line.slice(0, 30));
    await syncHistory();
    expect(searchHistory("tapir")).toEqual([]);
    fs.appendFileSync(f, line.slice(30) + "\n");
    await syncHistory();
    expect(searchHistory("tapir").length).toBe(1);
  });

  test("deleted files disappear; turning an app off removes what was indexed from it", async () => {
    fs.rmSync(path.join(home, ".cursor"), { recursive: true });
    await syncHistory();
    expect(searchHistory("capybara")).toEqual([]);
    setHistorySources(["claude-code"]);
    await syncHistory();
    expect(searchHistory("flamingo")).toEqual([]);
    expect(historyStatus().sources.find((s) => s.id === "codex")?.sessions).toBe(0);
    expect(() => readHistory(`codex:${CODEX}`)).toThrow();
    expect((await freshHistory()).complete).toBe(true);
    expect(searchHistory("zebra").length).toBe(1);
  });
});

describe("the agent's tools", () => {
  const run = async (tool: any, params: any) => (await tool.execute("id", params, undefined, undefined)).content.map((c: any) => c.text).join("");

  test("search_sessions covers this app and the others; read_session opens either", async () => {
    store.openDb(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-history-db-")), true);
    setHistorySources(["claude-code", "codex", "cursor"]);
    fs.mkdirSync(path.join(home, ".codex/sessions/2026/10/02"), { recursive: true });
    const search: any = createSearchSessionsTool({ sessionId: "me" } as any);
    const read: any = createReadSessionTool();

    const found = await run(search, { query: "flamingo" });
    expect(found).toContain(`[Codex] session codex:${CODEX} "Parser trailing commas"`);
    expect(found).toContain("/work/beta");
    expect(await run(search, { query: "flamingo", source: "kestrel" })).toBe("No matching sessions.");
    expect(await run(search, { query: "flamingo", source: "claude-code" })).toBe("No matching sessions.");
    expect(await run(read, { session_id: `codex:${CODEX}` })).toContain("Why does the flamingo parser");
    await expect(run(read, { session_id: "does-not-exist" })).rejects.toThrow("not found");
  });
});
