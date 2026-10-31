// pi-ai's messages in the AI SDK's shape, with provider metadata (signatures) carried through, and usage helpers.
import { type ModelMessage } from "ai";
import { type AssistantMessage, type Context, type Message, type Model, type ToolCall, type Usage } from "@mariozechner/pi-ai";
import { estimateMessageTokens, estimateTextTokens } from "../agent/compaction";

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/**
 * Some providers (notably subscription proxies) stream no token counts at all. Rather than book a
 * turn as free and empty, count it the same rough way compaction does, and say so on the usage.
 */
export function estimateUsage(output: AssistantMessage, context: Context) {
  const tools = (context.tools ?? []).map((t) => [t.name, t.description, t.parameters]);
  const input =
    estimateTextTokens(context.systemPrompt ?? "") +
    (tools.length ? estimateTextTokens(JSON.stringify(tools)) : 0) +
    context.messages.reduce((n, m) => n + estimateMessageTokens(m as any), 0);
  const out = estimateMessageTokens(output as any);
  output.usage.input = input;
  output.usage.output = out;
  output.usage.totalTokens = input + out;
  (output.usage as Usage & { estimated?: boolean }).estimated = true;
}

export function encodeMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || Object.keys(meta as object).length === 0) return undefined;
  return JSON.stringify(meta);
}

export function decodeMeta(sig: string | undefined): Record<string, any> | undefined {
  if (!sig) return undefined;
  try {
    const v = JSON.parse(sig);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function toModelMessages(messages: Message[], target: Model<any>): ModelMessage[] {
  const out: ModelMessage[] = [];
  const answered = new Set<string>();
  for (const m of messages) if (m.role === "toolResult") answered.add(m.toolCallId);

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
      } else {
        out.push({
          role: "user",
          content: m.content.map((c) =>
            c.type === "text"
              ? { type: "text" as const, text: c.text }
              : { type: "image" as const, image: c.data, mediaType: c.mimeType },
          ),
        });
      }
    } else if (m.role === "assistant") {
      const sameModel = m.provider === target.provider && m.model === target.id;
      const parts: any[] = [];
      const missing: ToolCall[] = [];
      for (const c of m.content) {
        if (c.type === "text") {
          if (!c.text) continue;
          parts.push({ type: "text", text: c.text, providerOptions: sameModel ? decodeMeta(c.textSignature) : undefined });
        } else if (c.type === "thinking") {
          if (!sameModel || !c.thinking) continue;
          parts.push({ type: "reasoning", text: c.thinking, providerOptions: decodeMeta(c.thinkingSignature) });
        } else if (c.type === "toolCall") {
          parts.push({
            type: "tool-call",
            toolCallId: c.id,
            toolName: c.name,
            input: c.arguments ?? {},
            providerOptions: sameModel ? decodeMeta(c.thoughtSignature) : undefined,
          });
          if (!answered.has(c.id)) missing.push(c);
        }
      }
      if (parts.length === 0) continue;
      out.push({ role: "assistant", content: parts });
      if (missing.length) {
        out.push({
          role: "tool",
          content: missing.map((c) => ({
            type: "tool-result" as const,
            toolCallId: c.id,
            toolName: c.name,
            output: { type: "error-text" as const, value: "Tool call was interrupted before producing a result." },
          })),
        });
      }
    } else if (m.role === "toolResult") {
      const hasImage = m.content.some((c) => c.type === "image");
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      const output = hasImage
        ? {
            type: "content" as const,
            value: m.content.map((c) =>
              c.type === "text"
                ? { type: "text" as const, text: c.text }
                : { type: "file" as const, data: { type: "data" as const, data: c.data }, mediaType: c.mimeType },
            ),
          }
        : m.isError
          ? { type: "error-text" as const, value: text || "error" }
          : { type: "text" as const, value: text };
      const part = { type: "tool-result" as const, toolCallId: m.toolCallId, toolName: m.toolName, output };
      const prev = out[out.length - 1];
      if (prev && prev.role === "tool") (prev.content as any[]).push(part);
      else out.push({ role: "tool", content: [part] });
    }
  }
  return out;
}

export function errorText(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const e = err as any;
  const parts = [e.message ?? String(err)];
  if (e.statusCode) parts.unshift(`HTTP ${e.statusCode}`);
  if (typeof e.responseBody === "string" && e.responseBody && !String(e.message).includes(e.responseBody)) {
    parts.push(e.responseBody.slice(0, 800));
  }
  return parts.join(": ");
}
