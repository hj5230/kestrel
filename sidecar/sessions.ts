import fs from "node:fs";
import type { ChatMessage, SessionInfo } from "../shared/protocol";
import * as store from "./db";
import { expandHome } from "./env";

export function newId(prefix = ""): string {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function defaultModel(): { providerId: string; modelId: string } {
  const s = store.getSettings();
  if (s.defaultProviderId && s.defaultModelId && store.getProvider(s.defaultProviderId)) {
    return { providerId: s.defaultProviderId, modelId: s.defaultModelId };
  }
  for (const p of store.listProviders()) {
    if (!p.enabled) continue;
    const m = store.listModels(p.id).find((m) => m.enabled);
    if (m) return { providerId: p.id, modelId: m.id };
  }
  return { providerId: "", modelId: "" };
}

export function createSession(input: Partial<SessionInfo> = {}): SessionInfo {
  const s = store.getSettings();
  const def = defaultModel();
  const cwd = expandHome(input.cwd || s.defaultCwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`目录不存在：${cwd}`);
  const now = Date.now();
  const info: SessionInfo = {
    id: newId(),
    title: input.title ?? "",
    cwd,
    providerId: input.providerId || def.providerId,
    modelId: input.modelId || def.modelId,
    thinking: input.thinking ?? s.defaultThinking,
    permissionMode: input.permissionMode ?? s.defaultPermissionMode,
    pinned: false,
    archived: false,
    kind: input.kind ?? "main",
    parentId: input.parentId ?? null,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    todos: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 },
    lastError: null,
    messageCount: 0,
  };
  store.insertSession(info);
  return store.getSession(info.id)!;
}

export function forkSession(sourceId: string, uptoSeq: number): SessionInfo {
  const src = store.getSession(sourceId);
  if (!src) throw new Error("会话不存在");
  const info = createSession({
    cwd: src.cwd,
    providerId: src.providerId,
    modelId: src.modelId,
    thinking: src.thinking,
    permissionMode: src.permissionMode,
    title: `${src.title || "未命名会话"}（分叉）`,
  });
  store.copyMessages(sourceId, info.id, uptoSeq);
  store.updateSession(info.id, { todos: src.todos }, true);
  return store.getSession(info.id)!;
}

function userText(m: ChatMessage): string {
  if (m.role !== "user") return "";
  const display = (m as any).display;
  if (display) return display;
  return typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "![image]")).join("\n");
}

export function exportMarkdown(id: string): string {
  const s = store.getSession(id);
  if (!s) throw new Error("会话不存在");
  const lines: string[] = [`# ${s.title || "未命名会话"}`, "", `- 目录：\`${s.cwd}\``, `- 模型：${s.modelId}`, `- 创建：${new Date(s.createdAt).toLocaleString("zh-CN")}`, ""];
  for (const { message: m } of store.loadMessages(id)) {
    if (m.role === "user") lines.push("## 用户", "", userText(m), "");
    else if (m.role === "assistant") {
      const parts: string[] = [];
      for (const c of m.content) {
        if (c.type === "text" && c.text.trim()) parts.push(c.text);
        else if (c.type === "toolCall") parts.push(`> 工具调用 \`${c.name}\`\n>\n> \`\`\`json\n${JSON.stringify(c.arguments, null, 2).split("\n").map((l) => "> " + l).join("\n")}\n> \`\`\``);
      }
      if (m.errorMessage) parts.push(`> 错误：${m.errorMessage}`);
      if (parts.length) lines.push("## 助手", "", parts.join("\n\n"), "");
    } else if (m.role === "toolResult") {
      const t = m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      lines.push(`<details><summary>${m.toolName} 结果${m.isError ? "（错误）" : ""}</summary>`, "", "```", t.slice(0, 5000), "```", "", "</details>", "");
    }
  }
  return lines.join("\n");
}
