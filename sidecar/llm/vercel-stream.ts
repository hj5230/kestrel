import { jsonSchema, streamText, type LanguageModel, type ToolSet } from "ai";
import { calculateCost, createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type SimpleStreamOptions, type StopReason, type ToolCall } from "@mariozechner/pi-ai";
import type { ProviderKind } from "../../shared/protocol";
import { reasoningRequest } from "./reasoning";
import { emptyUsage, estimateUsage, encodeMeta, toModelMessages, errorText, TEXT_ONLY_TOOL_RESULTS } from "./vercel-messages";
export { toModelMessages } from "./vercel-messages";

export type ModelResolver = (model: Model<any>) => {
  model: LanguageModel;
  kind?: ProviderKind;
  providerOptions?: Record<string, any>;
  headers?: Record<string, string>;
};

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
          messages: toModelMessages(context.messages, model, { imagesInToolResults: !TEXT_ONLY_TOOL_RESULTS.has(resolved.kind ?? "openai-compatible") }),
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
            ...(resolved.kind === "amazon-q" && options?.sessionId ? { "amazon-q": { ...resolved.providerOptions?.["amazon-q"], ...asked?.providerOptions?.["amazon-q"], conversationId: options.sessionId } } : {}),
          },
        } as any);

        let stopReason: StopReason = "stop";
        let failure: string | undefined;
        for await (const part of result.fullStream as AsyncIterable<any>) {
          // The SDK emits "start" before the request goes out; anything after it means the provider has answered.
          // Starting the message there keeps "waiting for the model" and "the model is replying" apart.
          if (part.type !== "start") start();
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
        start();
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
