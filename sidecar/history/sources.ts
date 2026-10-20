// Where other agent apps keep their conversations, and how to read them.
// Each source turns its own transcript lines into the same few events; the index does the rest.
// Everything here is read-only: nothing in these folders is ever written.
import fs from "node:fs";
import path from "node:path";
import { HOME } from "../env";

let home = HOME;
/** For tests: look for the other apps' folders somewhere else. */
export const setHistoryHome = (dir: string) => (home = dir);

export type HistorySourceId = "claude-code" | "codex" | "cursor";

export type HistoryEvent =
  | { t: "msg"; role: "user" | "assistant"; text: string; ts?: number }
  | { t: "tool"; text: string }
  | { t: "meta"; cwd?: string; startedAt?: number; title?: string; rank?: number }
  /** This file is not a conversation of the user's (an internal helper thread). */
  | { t: "skip" };

export interface HistorySource {
  id: HistorySourceId;
  label: string;
  /** The folder shown in settings. */
  root(): string;
  files(): string[];
  /** The session's id, from its file name. */
  idOf(file: string): string;
  /** Quick check on the raw line so large irrelevant lines are never parsed. */
  wants(line: string): boolean;
  parse(obj: any, withTools: boolean): HistoryEvent[];
  /** Names the app keeps outside the transcripts, by session id. */
  titles?(): Map<string, string>;
}

/** How much a title is trusted: the first message < one the app generated < one the user set. */
export const T_FIRST = 1;
const T_APP = 2;
const T_USER = 3;

function walk(dir: string, accept: (file: string, depth: number) => boolean, maxDepth: number, depth = 0, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < maxDepth) walk(p, accept, maxDepth, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith(".jsonl") && accept(p, depth)) out.push(p);
  }
  return out;
}

const time = (v: unknown) => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const baseName = (file: string) => path.basename(file, ".jsonl");

const clean = (s: string) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();

/** One line summary of a tool call, for reading a session. */
function toolLine(name: string, input: any): string {
  let args = "";
  if (input && typeof input === "object") {
    const v = input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.description;
    args = typeof v === "string" ? v : JSON.stringify(input);
  } else if (typeof input === "string") args = input;
  return `[tool ${name}: ${args.replace(/\s+/g, " ").slice(0, 300)}]`;
}

// ---------- Claude Code: ~/.claude/projects/<project>/<session>.jsonl ----------

const CLAUDE_NOISE = /^<(local-command-caveat|command-name|command-message|command-args|local-command-stdout|local-command-stderr|task-notification|bash-input|bash-stdout|bash-stderr)\b/;

const claude: HistorySource = {
  id: "claude-code",
  label: "Claude Code",
  root: () => path.join(home, ".claude", "projects"),
  // <project>/<session>.jsonl only; subagent transcripts sit in folders next to them
  files: () => walk(path.join(home, ".claude", "projects"), (_f, depth) => depth === 1, 1),
  idOf: baseName,
  wants: (l) => l.includes('"message"') || l.includes('"customTitle"') || l.includes('"aiTitle"'),
  parse(o, withTools) {
    if (o.type === "custom-title" && o.customTitle) return [{ t: "meta", title: String(o.customTitle), rank: T_USER }];
    if (o.type === "ai-title" && o.aiTitle) return [{ t: "meta", title: String(o.aiTitle), rank: T_APP }];
    if ((o.type !== "user" && o.type !== "assistant") || o.isSidechain || o.isMeta || o.isCompactSummary) return [];
    const ts = time(o.timestamp);
    const events: HistoryEvent[] = [];
    if (o.cwd) events.push({ t: "meta", cwd: o.cwd, startedAt: ts });
    const content = o.message?.content;
    const blocks: any[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        const text = clean(b.text);
        if (!text || (o.type === "user" && CLAUDE_NOISE.test(text))) continue;
        events.push({ t: "msg", role: o.type, text, ts });
      } else if (withTools && o.type === "assistant" && b?.type === "tool_use") events.push({ t: "tool", text: toolLine(String(b.name), b.input) });
    }
    return events;
  },
};

// ---------- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ----------

// Context the app injects as "user" turns
const CODEX_NOISE = /^(<(environment_context|user_instructions|guardian_tool_descriptions|external_codex_apps_open_page|turn_aborted|permissions instructions|collaboration_mode|skills_instructions|plugins_instructions|apps_instructions|no retained transcript[^>]*)\b|# AGENTS\.md instructions|# Context from)/;

const codex: HistorySource = {
  id: "codex",
  label: "Codex",
  root: () => path.join(home, ".codex", "sessions"),
  files: () => [
    ...walk(path.join(home, ".codex", "sessions"), () => true, 4),
    ...walk(path.join(home, ".codex", "archived_sessions"), () => true, 1),
  ],
  idOf: (file) => path.basename(file).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)?.pop() ?? baseName(file),
  wants: (l) => l.includes('"session_meta"') || l.includes('"message"') || l.includes('"function_call"'),
  parse(o, withTools) {
    const p = o.payload;
    if (!p) return [];
    if (o.type === "session_meta") {
      // guardian reviews and other helper threads are not conversations
      if (p.thread_source && p.thread_source !== "user") return [{ t: "skip" }];
      return [{ t: "meta", cwd: p.cwd, startedAt: time(p.timestamp) ?? time(o.timestamp) }];
    }
    if (o.type !== "response_item") return [];
    const ts = time(o.timestamp);
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const events: HistoryEvent[] = [];
      for (const c of p.content ?? []) {
        if (typeof c?.text !== "string") continue;
        const text = c.text.trim();
        if (!text || (p.role === "user" && CODEX_NOISE.test(text))) continue;
        events.push({ t: "msg", role: p.role, text, ts });
      }
      return events;
    }
    if (withTools && p.type === "function_call") {
      let args: any = p.arguments;
      try {
        args = JSON.parse(p.arguments);
      } catch {}
      return [{ t: "tool", text: toolLine(String(p.name), args) }];
    }
    return [];
  },
  titles() {
    const out = new Map<string, string>();
    try {
      for (const l of fs.readFileSync(path.join(home, ".codex", "session_index.jsonl"), "utf8").split("\n")) {
        try {
          const d = JSON.parse(l);
          if (d.id && d.thread_name) out.set(d.id, String(d.thread_name));
        } catch {}
      }
    } catch {}
    return out;
  },
};

// ---------- Cursor agent: ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl ----------

const cursor: HistorySource = {
  id: "cursor",
  label: "Cursor",
  root: () => path.join(home, ".cursor", "projects"),
  files: () => {
    const out: string[] = [];
    let projects: fs.Dirent[] = [];
    try {
      projects = fs.readdirSync(path.join(home, ".cursor", "projects"), { withFileTypes: true });
    } catch {}
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      // <id>.jsonl or <id>/<id>.jsonl; helper threads live under <id>/subagents/
      walk(path.join(home, ".cursor", "projects", p.name, "agent-transcripts"), (f) => !f.includes(`${path.sep}subagents${path.sep}`), 1, 0, out);
    }
    return out;
  },
  idOf: baseName,
  wants: (l) => l.includes('"role"'),
  parse(o, withTools) {
    if ((o.role !== "user" && o.role !== "assistant") || !Array.isArray(o.message?.content)) return [];
    const events: HistoryEvent[] = [];
    for (const b of o.message.content) {
      if (b?.type === "text" && typeof b.text === "string") {
        let text = b.text;
        if (o.role === "user") {
          // the question is wrapped; the rest is context the app attached
          const q = /<user_query>([\s\S]*?)<\/user_query>/.exec(text);
          if (q) text = q[1];
        }
        text = clean(text);
        if (text) events.push({ t: "msg", role: o.role, text });
      } else if (withTools && o.role === "assistant" && b?.type === "tool_use") events.push({ t: "tool", text: toolLine(String(b.name), b.input) });
    }
    return events;
  },
};

export const SOURCES: HistorySource[] = [claude, codex, cursor];
export const DEFAULT_HISTORY_SOURCES: HistorySourceId[] = SOURCES.map((s) => s.id);
export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);
