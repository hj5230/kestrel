import { jsonSchema, streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type ToolCall,
  type Usage,
} from "@mariozechner/pi-ai";
import type { ProviderKind } from "../../shared/protocol";
import { estimateMessageTokens, estimateTextTokens } from "../agent/compaction";
import { reasoningRequest } from "./reasoning";

export type ModelResolver = (model: Model<any>) => {
  model: LanguageModel;
  kind?: ProviderKind;
  providerOptions?: Record<string, any>;
  headers?: Record<string, string>;
};

const emptyUsage = (): Usage => ({
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
function estimateUsage(output: AssistantMessage, context: Context) {
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

function encodeMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object" || Object.keys(meta as object).length === 0) return undefined;
  return JSON.stringify(meta);
}

function decodeMeta(sig: string | undefined): Record<string, any> | undefined {
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

function errorText(err: unknown): string {
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

export function createVercelStreamFn(resolve: ModelResolver) {
  return (model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };

    (async () => {
      const blocks = new Map<string, number>();
      const toolArgs = new Map<number, string>();
      let started = false;
      const start = () => {
        if (!started) {
          started = true;
          stream.push({ type: "start", partial: output });
        }
      };
      try {
        const resolved = resolve(model);
        const tools: ToolSet = {};
        for (const t of context.tools ?? []) {
          tools[t.name] = { description: t.description, inputSchema: jsonSchema(t.parameters as any) } as any;
        }
        const level = typeof options?.reasoning === "string" ? options.reasoning : undefined;
        const asked = resolved.kind && level ? reasoningRequest(resolved.kind, level) : undefined;
        const result = streamText({
          model: resolved.model,
          system: context.systemPrompt,
          messages: toModelMessages(context.messages, model),
          tools: Object.keys(tools).length ? tools : undefined,
          maxOutputTokens: options?.maxTokens,
          temperature: options?.temperature,
          abortSignal: options?.signal,
          headers: { ...resolved.headers, ...options?.headers },
          maxRetries: options?.maxRetries ?? 2,
          onError: () => {},
          reasoning: asked?.reasoning,
          providerOptions: {
            ...resolved.providerOptions, ...asked?.providerOptions,
          },
        } as any);

        let stopReason: StopReason = "stop";
        let failure: string | undefined;
        start();
        for await (const part of result.fullStream as AsyncIterable<any>) {
          switch (part.type) {
            case "text-start": {
              output.content.push({ type: "text", text: "" });
              const idx = output.content.length - 1;
              blocks.set(`t:${part.id}`, idx);
              stream.push({ type: "text_start", contentIndex: idx, partial: output });
              break;
            }
            case "text-delta": {
              let idx = blocks.get(`t:${part.id}`);
              if (idx === undefined) {
                output.content.push({ type: "text", text: "" });
                idx = output.content.length - 1;
                blocks.set(`t:${part.id}`, idx);
                stream.push({ type: "text_start", contentIndex: idx, partial: output });
              }
              const block = output.content[idx] as any;
              block.text += part.text;
              stream.push({ type: "text_delta", contentIndex: idx, delta: part.text, partial: output });
              break;
            }
            case "text-end": {
              const idx = blocks.get(`t:${part.id}`);
              if (idx === undefined) break;
              const block = output.content[idx] as any;
              const sig = encodeMeta(part.providerMetadata);
              if (sig) block.textSignature = sig;
              stream.push({ type: "text_end", contentIndex: idx, content: block.text, partial: output });
              break;
            }
            case "reasoning-start": {
              output.content.push({ type: "thinking", thinking: "" });
              const idx = output.content.length - 1;
              blocks.set(`r:${part.id}`, idx);
              stream.push({ type: "thinking_start", contentIndex: idx, partial: output });
              break;
            }
            case "reasoning-delta": {
              let idx = blocks.get(`r:${part.id}`);
              if (idx === undefined) {
                output.content.push({ type: "thinking", thinking: "" });
                idx = output.content.length - 1;
                blocks.set(`r:${part.id}`, idx);
                stream.push({ type: "thinking_start", contentIndex: idx, partial: output });
              }
              const block = output.content[idx] as any;
              block.thinking += part.text;
              const sig = encodeMeta(part.providerMetadata);
              if (sig) block.thinkingSignature = sig;
              stream.push({ type: "thinking_delta", contentIndex: idx, delta: part.text, partial: output });
              break;
            }
            case "reasoning-end": {
              const idx = blocks.get(`r:${part.id}`);
              if (idx === undefined) break;
              const block = output.content[idx] as any;
              const sig = encodeMeta(part.providerMetadata);
              if (sig) block.thinkingSignature = sig;
              stream.push({ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: output });
              break;
            }
            case "tool-input-start": {
              output.content.push({ type: "toolCall", id: part.id, name: part.toolName, arguments: {} });
              const idx = output.content.length - 1;
              blocks.set(`c:${part.id}`, idx);
              toolArgs.set(idx, "");
              stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
              break;
            }
            case "tool-input-delta": {
              const idx = blocks.get(`c:${part.id}`);
              if (idx === undefined) break;
              toolArgs.set(idx, (toolArgs.get(idx) ?? "") + part.delta);
              stream.push({ type: "toolcall_delta", contentIndex: idx, delta: part.delta, partial: output });
              break;
            }
            case "tool-call": {
              let idx = blocks.get(`c:${part.toolCallId}`);
              if (idx === undefined) {
                output.content.push({ type: "toolCall", id: part.toolCallId, name: part.toolName, arguments: {} });
                idx = output.content.length - 1;
                blocks.set(`c:${part.toolCallId}`, idx);
                stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
              }
              const block = output.content[idx] as ToolCall;
              let input = part.input;
              if (typeof input === "string") {
                try {
                  input = JSON.parse(input || "{}");
                } catch {
                  input = {};
                }
              }
              block.arguments = input ?? {};
              const sig = encodeMeta(part.providerMetadata);
              if (sig) block.thoughtSignature = sig;
              stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: block, partial: output });
              break;
            }
            case "finish-step": {
              const u = part.usage ?? {};
              const cacheRead = u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0;
              const cacheWrite = u.inputTokenDetails?.cacheWriteTokens ?? 0;
              const input = u.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite);
              output.usage.input += input;
              output.usage.output += u.outputTokens ?? 0;
              output.usage.cacheRead += cacheRead;
              output.usage.cacheWrite += cacheWrite;
              output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
              if (part.response?.modelId) output.responseModel = part.response.modelId;
              if (part.response?.id) output.responseId = part.response.id;
              break;
            }
            case "finish": {
              stopReason = part.finishReason === "tool-calls" ? "toolUse" : part.finishReason === "length" ? "length" : "stop";
              if (part.finishReason === "error") failure = failure ?? "Model reported an error";
              break;
            }
            case "error":
              failure = errorText(part.error);
              break;
            case "abort":
              if (!options?.signal?.aborted) failure = failure ?? "Request aborted";
              break;
          }
        }
        if (output.content.some((c) => c.type === "toolCall") && stopReason === "stop") stopReason = "toolUse";
        if (!failure && !options?.signal?.aborted && output.usage.totalTokens === 0 && output.content.length) estimateUsage(output, context);
        output.usage.cost = calculateCost(model, output.usage);
        if (options?.signal?.aborted) {
          output.stopReason = "aborted";
          output.errorMessage = "Aborted";
          stream.push({ type: "error", reason: "aborted", error: output });
        } else if (failure) {
          output.stopReason = "error";
          output.errorMessage = failure;
          stream.push({ type: "error", reason: "error", error: output });
        } else {
          output.stopReason = stopReason;
          stream.push({ type: "done", reason: stopReason as "stop" | "length" | "toolUse", message: output });
        }
        stream.end(output);
      } catch (err) {
        start();
        const aborted = options?.signal?.aborted;
        output.stopReason = aborted ? "aborted" : "error";
        output.errorMessage = aborted ? "Aborted" : errorText(err);
        stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: output });
        stream.end(output);
      }
    })();

    return stream;
  };
}
