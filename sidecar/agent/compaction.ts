import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { generateText } from "ai";
import { languageModel } from "../providers";
import { usageOf } from "../side-model";

export function estimateTextTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other * 0.9);
}

export function estimateMessageTokens(m: AgentMessage): number {
  const msg = m as any;
  if (msg.role === "user") {
    if (typeof msg.content === "string") return estimateTextTokens(msg.content) + 4;
    return msg.content.reduce((n: number, c: any) => n + (c.type === "text" ? estimateTextTokens(c.text) : 1200), 4);
  }
  if (msg.role === "assistant") {
    return msg.content.reduce(
      (n: number, c: any) =>
        n + (c.type === "text" ? estimateTextTokens(c.text) : c.type === "thinking" ? estimateTextTokens(c.thinking) : estimateTextTokens(JSON.stringify(c.arguments ?? {})) + 10),
      4,
    );
  }
  if (msg.role === "toolResult") {
    return msg.content.reduce((n: number, c: any) => n + (c.type === "text" ? estimateTextTokens(c.text) : 1200), 6);
  }
  return 0;
}

export function estimateContextTokens(messages: AgentMessage[], summary: string | null, trustUsageAfter = 0, overhead = 0): number {
  let lastUsageIdx = -1;
  let base = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m.role === "assistant" && m.usage && m.timestamp > trustUsageAfter && m.stopReason !== "error" && m.stopReason !== "aborted") {
      const u = m.usage;
      const total = u.input + u.cacheRead + u.cacheWrite + u.output;
      if (total > 0) {
        lastUsageIdx = i;
        base = total;
        break;
      }
    }
  }
  if (lastUsageIdx < 0) {
    return messages.reduce((n, m) => n + estimateMessageTokens(m), overhead + (summary ? estimateTextTokens(summary) : 0));
  }
  return base + messages.slice(lastUsageIdx + 1).reduce((n, m) => n + estimateMessageTokens(m), 0);
}

export function findCutIndex(messages: AgentMessage[], start: number, keepRecentTokens: number): number {
  let acc = 0;
  let idx = messages.length;
  for (let i = messages.length - 1; i > start; i--) {
    acc += estimateMessageTokens(messages[i]);
    idx = i;
    if (acc >= keepRecentTokens) break;
  }
  for (let i = idx; i < messages.length; i++) {
    const role = (messages[i] as any).role;
    if (role === "user" || role === "assistant") {
      if (i > start) return i;
    }
  }
  for (let i = messages.length - 1; i > start; i--) {
    const role = (messages[i] as any).role;
    if (role === "user" || role === "assistant") return i;
  }
  return -1;
}

function serialize(messages: AgentMessage[], maxChars: number): string {
  const out: string[] = [];
  for (const m of messages as any[]) {
    if (m.role === "user") {
      const t = typeof m.content === "string" ? m.content : m.content.map((c: any) => (c.type === "text" ? c.text : "[image]")).join("\n");
      out.push(`[User]\n${t}`);
    } else if (m.role === "assistant") {
      const segs: string[] = [];
      for (const c of m.content) {
        if (c.type === "text" && c.text.trim()) segs.push(c.text);
        else if (c.type === "toolCall") segs.push(`(tool call ${c.name} ${JSON.stringify(c.arguments).slice(0, 600)})`);
      }
      if (m.errorMessage) segs.push(`(error: ${m.errorMessage.slice(0, 300)})`);
      if (segs.length) out.push(`[Assistant]\n${segs.join("\n")}`);
    } else if (m.role === "toolResult") {
      const t = m.content.map((c: any) => (c.type === "text" ? c.text : "[image]")).join("\n");
      const clipped = t.length > 1500 ? `${t.slice(0, 1000)}\n…\n${t.slice(-400)}` : t;
      out.push(`[Tool result: ${m.toolName}${m.isError ? " (error)" : ""}]\n${clipped}`);
    }
  }
  let s = out.join("\n\n");
  if (s.length > maxChars) s = `…(earliest part omitted)…\n\n${s.slice(s.length - maxChars)}`;
  return s;
}

const SUMMARY_PROMPT = `You are compacting a long conversation between a user and an AI agent so the agent can continue the work with a fresh context window. Write a dense, structured summary that preserves everything needed to continue seamlessly. Use the same language as the conversation.

Include these sections:
1. User goals and requests — every explicit request and constraint, in the user's own words where precise wording matters.
2. Key decisions and conclusions — what was decided, chosen or ruled out, and why.
3. Files and resources — paths of files read, created or modified (with what changed), commands that matter, URLs, ids.
4. Current state — what has been completed and verified, what is in progress, any errors encountered and how they were resolved.
5. User preferences and feedback — corrections the user gave about how to work.
6. Next steps — exactly what remains to be done, in order.

Be specific (exact names, numbers, paths). Do not invent anything. Output only the summary.`;

export async function summarize(opts: {
  providerId: string;
  modelId: string;
  contextWindow: number;
  previousSummary: string | null;
  messages: AgentMessage[];
  instructions?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number } }> {
  const maxChars = Math.max(20000, Math.floor(opts.contextWindow * 2.2));
  const transcript = serialize(opts.messages, maxChars);
  const prompt = [
    opts.previousSummary ? `<previous_summary>\n${opts.previousSummary}\n</previous_summary>\n` : "",
    `<conversation>\n${transcript}\n</conversation>`,
    opts.instructions ? `\nAdditional focus requested by the user: ${opts.instructions}` : "",
    opts.previousSummary ? "\nMerge the previous summary with the new conversation into a single updated summary." : "",
  ].join("\n");
  const res = await generateText({
    model: languageModel(opts.providerId, opts.modelId),
    system: SUMMARY_PROMPT,
    prompt,
    abortSignal: opts.signal,
    maxRetries: 2,
  });
  return { summary: res.text.trim(), usage: usageOf(res.usage) };
}

export function summaryMessage(summary: string): AgentMessage {
  return {
    role: "user",
    content: `<conversation_summary>\nThe earlier part of this conversation was compacted to save context. Summary:\n\n${summary}\n</conversation_summary>\n\nContinue from where the conversation left off.`,
    timestamp: 0,
  } as AgentMessage;
}
