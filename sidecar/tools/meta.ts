import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { ChatMessage, Todo } from "../../shared/protocol";
import * as store from "../db";
import { findSkill } from "../skills";
import { text, defineTool, type HelmTool, type ToolContext } from "./types";

export function createTodoTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "todo_write",
    label: "更新计划",
    category: "meta",
    description:
      "Create or update the task plan shown to the user. Use it for multi-step tasks (3+ steps): pass the complete list every time. " +
      "Keep exactly one item in_progress while working, and mark items completed as soon as they are done.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ description: "Imperative description, e.g. 'Run tests'" }),
          status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
          activeForm: Type.Optional(Type.String({ description: "Present continuous form, e.g. 'Running tests'" })),
        }),
      ),
    }),
    async execute(_id, params) {
      const todos = params.todos as Todo[];
      ctx.setTodos(todos);
      const done = todos.filter((t) => t.status === "completed").length;
      return { content: text(`Plan updated (${done}/${todos.length} completed).`), details: { todos } };
    },
  });
}

export function createTaskTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "task",
    label: "子代理",
    category: "meta",
    description:
      "Launch a subagent with its own fresh context to handle a self-contained task (broad codebase searches, research, " +
      "multi-file investigation) and return a concise report. The subagent has the same tools except task. " +
      "Write a complete brief: it cannot see this conversation. Launch several in parallel for independent questions.",
    parameters: Type.Object({
      description: Type.String({ description: "Short (3-6 word) task title" }),
      prompt: Type.String({ description: "Full self-contained instructions and what to report back" }),
    }),
    async execute(_id, params, signal, onUpdate) {
      let last: any = {};
      const report = await ctx.runSubagent({ description: params.description, prompt: params.prompt }, signal, (details) => {
        last = details;
        onUpdate?.({ content: [], details });
      });
      return { content: text(report), details: { ...last, status: "done", description: params.description } };
    },
  });
}

function renderTranscript(messages: ChatMessage[], maxChars: number): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const t = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      parts.push(`## User\n${t}`);
    } else if (m.role === "assistant") {
      const segs: string[] = [];
      for (const c of m.content) {
        if (c.type === "text" && c.text.trim()) segs.push(c.text);
        else if (c.type === "toolCall") segs.push(`[tool ${c.name}: ${JSON.stringify(c.arguments).slice(0, 300)}]`);
      }
      if (segs.length) parts.push(`## Assistant\n${segs.join("\n")}`);
    } else if (m.role === "toolResult") {
      const t = m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      parts.push(`[result ${m.toolName}${m.isError ? " (error)" : ""}: ${t.slice(0, 400)}]`);
    }
  }
  let out = parts.join("\n\n");
  if (out.length > maxChars) out = out.slice(0, maxChars) + `\n\n[Truncated; ${out.length - maxChars} more characters]`;
  return out;
}

export function createSearchSessionsTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "search_sessions",
    label: "检索历史会话",
    category: "read",
    description:
      "Full-text search across the user's past conversations in this app (titles and messages). " +
      "Use when the user refers to earlier work ('之前我们…', 'that thing from last week'). Returns session ids with snippets; " +
      "then use read_session to read one.",
    parameters: Type.Object({
      query: Type.String({ description: "Keywords (3+ characters each match best, CJK supported)" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_id, params) {
      const hits = store.searchMessages(params.query, params.limit ?? 20, ctx.sessionId);
      if (!hits.length) return { content: text("No matching sessions."), details: { hits: [] } };
      const body = hits
        .map((h) => `- session ${h.sessionId} 「${h.title || "未命名"}」 (${new Date(h.updatedAt).toLocaleString("zh-CN")})\n  ${h.role}#${h.seq}: ${h.snippet}`)
        .join("\n");
      return { content: text(body), details: { hits } };
    },
  });
}

export function createReadSessionTool(): HelmTool {
  return defineTool({
    name: "read_session",
    label: "读取历史会话",
    category: "read",
    description: "Read the transcript of a past session by id (from search_sessions). Use from_seq to read later parts of long sessions.",
    parameters: Type.Object({
      session_id: Type.String(),
      from_seq: Type.Optional(Type.Integer({ minimum: 0 })),
      max_chars: Type.Optional(Type.Integer({ minimum: 2000, maximum: 100000 })),
    }),
    async execute(_id, params) {
      const s = store.getSession(params.session_id);
      if (!s) throw new Error(`Session ${params.session_id} not found`);
      const msgs = store.loadMessages(s.id).filter((m) => m.seq >= (params.from_seq ?? 0));
      const header = `# ${s.title || "未命名会话"}\ncwd: ${s.cwd}\nupdated: ${new Date(s.updatedAt).toLocaleString("zh-CN")}\nmessages: ${msgs.length}\n\n`;
      const compactions = store.listCompactions(s.id);
      const summary = compactions.length && !params.from_seq ? `[Earlier summary]\n${compactions[compactions.length - 1].summary}\n\n` : "";
      return {
        content: text(header + summary + renderTranscript(msgs.map((m) => m.message), params.max_chars ?? 30000)),
        details: { sessionId: s.id },
      };
    },
  });
}

export function createSkillTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "skill",
    label: "加载技能",
    category: "read",
    description:
      "Load a skill's full instructions by name (see the available skills list in the system prompt). " +
      "Call this before doing a task that matches a skill's description, then follow the instructions it returns.",
    parameters: Type.Object({ name: Type.String({ description: "Skill name" }) }),
    async execute(_id, params) {
      const skill = findSkill(ctx.cwd(), params.name);
      if (!skill) throw new Error(`Unknown skill "${params.name}"`);
      const body = fs.readFileSync(skill.path, "utf8");
      const dir = path.dirname(skill.path);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f !== "SKILL.md").slice(0, 50);
      } catch {}
      const listing = files.length ? `\n\nOther files in the skill directory (read them when the instructions reference them):\n${files.map((f) => `- ${path.join(dir, f)}`).join("\n")}` : "";
      return {
        content: text(`Skill directory: ${dir}\n\n${body}${listing}`),
        details: { name: skill.name, path: skill.path },
      };
    },
  });
}
