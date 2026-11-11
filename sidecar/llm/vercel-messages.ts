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

export interface MessageOptions {
  /**
   * Whether the provider's adapter sends images inside a tool result as images. The OpenAI-compatible
   * adapter doesn't: it JSON-encodes the whole result, so a screenshot reaches the model as megabytes of
   * base64 text and overflows the context. For those, images move to a user message after the results.
   */
  imagesInToolResults?: boolean;
}

/** Providers whose AI SDK adapter turns image parts of a tool result into text. */
export const TEXT_ONLY_TOOL_RESULTS = new Set(["openai-compatible", "openrouter", "ollama"]);

const IMAGE_OMITTED = "[image omitted: this model does not accept images]";

export function toModelMessages(messages: Message[], target: Model<any>, opts: MessageOptions = {}): ModelMessage[] {
  const out: ModelMessage[] = [];
  const answered = new Set<string>();
  for (const m of messages) if (m.role === "toolResult") answered.add(m.toolCallId);
  const vision = target.input.includes("image");
  const inline = opts.imagesInToolResults ?? true;
  // Images taken out of tool results, sent once the run of results is over.
  let hoisted: { type: "image"; image: string; mediaType: string }[] = [];
  const flush = () => {
    if (!hoisted.length) return;
    out.push({ role: "user", content: [{ type: "text", text: "Images returned by the tool calls above, in order:" }, ...hoisted] });
    hoisted = [];
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "toolResult") flush();
    if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
      } else {
        out.push({
          role: "user",
          content: m.content.map((c) =>
            c.type === "text"
              ? { type: "text" as const, text: c.text }
              : vision
                ? { type: "image" as const, image: c.data, mediaType: c.mimeType }
                : { type: "text" as const, text: IMAGE_OMITTED },
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
      const images = m.content.filter((c) => c.type === "image");
      const hasImage = vision && inline && images.length > 0;
      if (vision && !inline) for (const c of images as any[]) hoisted.push({ type: "image", image: c.data, mediaType: c.mimeType });
      const text = [
        ...m.content.filter((c) => c.type === "text").map((c: any) => c.text),
        ...(images.length && !hasImage ? [vision ? `[${images.length} image(s) attached in the next message]` : IMAGE_OMITTED] : []),
      ].join("\n");
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
  flush();
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
