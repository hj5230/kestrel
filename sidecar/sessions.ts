import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, SessionInfo } from "../shared/protocol";
import * as store from "./db";
import { expandHome } from "./env";
import { dateLocale, st } from "./i18n";
import { sessionUploadDir } from "./uploads";

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
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(st("dirNotFound", { path: cwd }));
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

export function forkSession(sourceId: string, uptoSeq: number, dataDir?: string): SessionInfo {
  const src = store.getSession(sourceId);
  if (!src) throw new Error(st("sessionNotFound"));
  const info = createSession({
    cwd: src.cwd,
    providerId: src.providerId,
    modelId: src.modelId,
    thinking: src.thinking,
    permissionMode: src.permissionMode,
    title: `${src.title || st("untitled")}${st("forkSuffix")}`,
  });
  store.copyMessages(sourceId, info.id, uptoSeq);
  if (dataDir) {
    const sourceDir = sessionUploadDir(dataDir, sourceId);
    const targetDir = sessionUploadDir(dataDir, info.id);
    const sourcePrefix = sourceDir.endsWith(path.sep) ? sourceDir : sourceDir + path.sep;
    const targetPrefix = targetDir.endsWith(path.sep) ? targetDir : targetDir + path.sep;
    if (fs.existsSync(sourceDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: false });
      store.rewriteSessionPathPrefix(info.id, sourcePrefix, targetPrefix);
    }
  }
  store.updateSession(info.id, { todos: src.todos }, true);
  return store.getSession(info.id)!;
}

function userText(m: ChatMessage): string {
  if (m.role !== "user") return "";
  const display = (m as any).display;
  if (display) return display;
  const files = ((m as any).files ?? []) as { name: string }[];
  const fileNotes = files.map((f) => `[file] ${f.name}`);
  const content = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "![image]")).join("\n");
  return [content, ...fileNotes].filter(Boolean).join("\n");
}

export function exportMarkdown(id: string): string {
  const s = store.getSession(id);
  if (!s) throw new Error(st("sessionNotFound"));
  const lines: string[] = [
    `# ${s.title || st("untitled")}`,
    "",
    `- ${st("exportFolder")}: \`${s.cwd}\``,
    `- ${st("exportModel")}: ${s.modelId}`,
    `- ${st("exportCreated")}: ${new Date(s.createdAt).toLocaleString(dateLocale())}`,
    "",
  ];
  for (const { message: m } of store.loadMessages(id)) {
    if (m.role === "user") lines.push(`## ${st("exportUser")}`, "", userText(m), "");
    else if (m.role === "assistant") {
      const parts: string[] = [];
      for (const c of m.content) {
        if (c.type === "text" && c.text.trim()) parts.push(c.text);
        else if (c.type === "toolCall") parts.push(`> ${st("exportToolCall")} \`${c.name}\`\n>\n> \`\`\`json\n${JSON.stringify(c.arguments, null, 2).split("\n").map((l) => "> " + l).join("\n")}\n> \`\`\``);
      }
      if (m.errorMessage) parts.push(`> ${st("exportError")}: ${m.errorMessage}`);
      if (parts.length) lines.push(`## ${st("exportAssistant")}`, "", parts.join("\n\n"), "");
    } else if (m.role === "toolResult") {
      const t = m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("\n");
      lines.push(`<details><summary>${st(m.isError ? "exportResultError" : "exportResult", { tool: m.toolName })}</summary>`, "", "```", t.slice(0, 5000), "```", "", "</details>", "");
    }
  }
  return lines.join("\n");
}
