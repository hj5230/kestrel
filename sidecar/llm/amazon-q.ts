// Native AI SDK adapter for Amazon Q API keys. Tool execution stays in Kestrel's agent loop.
import type {
  LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Content,
  LanguageModelV4GenerateResult, LanguageModelV4StreamPart, LanguageModelV4StreamResult,
  LanguageModelV4Usage, SharedV4Warning,
} from "@ai-sdk/provider";
import { AmazonQClient, amazonQEvents } from "./amazon-q-api";
import { amazonQPrompt } from "./amazon-q-prompt";

type Part = LanguageModelV4StreamPart;
const emptyUsage = (): LanguageModelV4Usage => ({
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
});

/** Adapted from pi-kiro's MIT thinking parser: hold only a possible tag suffix across chunks. */
class InlineThinking {
  private buffer = "";
  private closing?: string;
  private readonly pairs = [["<thinking>", "</thinking>"], ["<think>", "</think>"], ["<reasoning>", "</reasoning>"], ["<thought>", "</thought>"]];
  constructor(private emit: (kind: "text" | "reasoning", value: string) => void) {}
  feed(value: string) {
    this.buffer += value;
    while (this.buffer) {
      const tags = this.closing ? [[this.closing, ""]] : this.pairs;
      const found = tags.map(([open, close]) => ({ open: open!, close: close!, index: this.buffer.indexOf(open!) }))
        .filter((match) => match.index >= 0).sort((a, b) => a.index - b.index)[0];
      const kind = this.closing ? "reasoning" : "text";
      if (found) {
        this.emit(kind, this.buffer.slice(0, found.index));
        this.buffer = this.buffer.slice(found.index + found.open.length);
        this.closing = this.closing ? undefined : found.close;
        continue;
      }
      let held = 0;
      for (const [tag] of tags) {
        for (let n = Math.min(this.buffer.length, tag!.length - 1); n > held; n--) {
          if (this.buffer.endsWith(tag!.slice(0, n))) { held = n; break; }
        }
      }
      this.emit(kind, this.buffer.slice(0, this.buffer.length - held));
      this.buffer = this.buffer.slice(this.buffer.length - held);
      break;
    }
  }
  flush() { this.emit(this.closing ? "reasoning" : "text", this.buffer); this.buffer = ""; }
}

async function* translatedEvents(reader: ReadableStreamDefaultReader<Uint8Array>, names: Map<string, string>, declared: Set<string>, options: LanguageModelV4CallOptions): AsyncGenerator<Part> {
  const queue: Part[] = [];
  let block: { type: "text" | "reasoning"; id: string } | undefined;
  let blockCount = 0;
  const closeBlock = () => {
    if (block) queue.push({ type: block.type === "text" ? "text-end" : "reasoning-end", id: block.id });
    block = undefined;
  };
  const emit = (type: "text" | "reasoning", value: string) => {
    if (!value) return;
    if (block?.type !== type) {
      closeBlock();
      block = { type, id: `amazon-q-${blockCount++}` };
      queue.push({ type: type === "text" ? "text-start" : "reasoning-start", id: block.id });
    }
    queue.push({ type: type === "text" ? "text-delta" : "reasoning-delta", id: block!.id, delta: value });
  };
  const text = new InlineThinking(emit);
  const tools = new Map<string, { name: string; input: string; emptyObject: boolean; done: boolean }>();
  let currentTool: string | undefined;
  let stopReason: string | undefined;
  let sawMetadata = false;
  let contentSeen = false;
  const usage = emptyUsage();
  const metadata: Record<string, any> = {};

  for await (const { type, data: raw } of amazonQEvents(reader, options.abortSignal)) {
    const data = raw[type] ?? raw;
    if (options.includeRawChunks) yield { type: "raw", rawValue: { type, data } };
    if (type === "assistantResponseEvent" || type === "codeEvent") {
      const value = data.content;
      if (typeof value === "string") { text.feed(value); contentSeen ||= !!value; }
      if (typeof data.modelId === "string") yield { type: "response-metadata", modelId: data.modelId };
    } else if (type === "reasoningContentEvent") {
      text.flush();
      if (typeof data.text === "string") { emit("reasoning", data.text); contentSeen ||= !!data.text; }
      if (typeof data.signature === "string") metadata.reasoningSignature = data.signature;
      if (typeof data.redactedContent === "string") metadata.redactedReasoning = data.redactedContent;
    } else if (type === "toolUseEvent") {
      text.flush();
      closeBlock();
      while (queue.length) yield queue.shift()!;
      const id = typeof data.toolUseId === "string" ? data.toolUseId : currentTool;
      if (!id) throw new Error("Amazon Q tool fragment is missing a toolUseId");
      let tool = tools.get(id);
      if (!tool) {
        if (typeof data.name !== "string" || !declared.has(data.name)) throw new Error("Amazon Q returned an undeclared tool");
        tool = { name: names.get(data.name)!, input: "", emptyObject: false, done: false };
        tools.set(id, tool);
        yield { type: "tool-input-start", id, toolName: tool.name };
      }
      if (tool.done || (data.name && names.get(data.name) !== tool.name)) throw new Error("Invalid Amazon Q tool continuation");
      currentTool = id;
      if (data.input != null) {
        if (typeof data.input === "object" && !Array.isArray(data.input) && !Object.keys(data.input).length) tool.emptyObject = true;
        else {
          const delta = typeof data.input === "string" ? data.input : JSON.stringify(data.input);
          tool.input += delta;
          if (delta) yield { type: "tool-input-delta", id, delta };
        }
      }
      if (data.stop === true) {
        const input = tool.input || (tool.emptyObject ? "{}" : "");
        let parsed: unknown;
        try { parsed = JSON.parse(input); } catch { throw new Error(`Amazon Q returned invalid JSON for tool ${tool.name}`); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Amazon Q returned non-object arguments for tool ${tool.name}`);
        tool.done = true;
        currentTool = undefined;
        yield { type: "tool-input-end", id };
        yield { type: "tool-call", toolCallId: id, toolName: tool.name, input };
        contentSeen = true;
      }
    } else if (type === "metadataEvent") {
      sawMetadata = true;
      stopReason = data.stopReason;
    } else if (type === "contextUsageEvent") {
      if (typeof data.contextUsagePercentage === "number") metadata.contextUsagePercentage = data.contextUsagePercentage;
    } else if (type === "meteringEvent") {
      if (typeof data.usage === "number") { metadata.creditUsage = data.usage; metadata.creditUnit = data.unit ?? "credit"; }
    } else if (type === "tokenUsageEvent" || type === "usageEvent") {
      const tokens = data.usage ?? data;
      if (typeof tokens.inputTokens === "number") usage.inputTokens.total = tokens.inputTokens;
      if (typeof tokens.outputTokens === "number") usage.outputTokens.total = tokens.outputTokens;
      if (typeof tokens.cacheReadInputTokens === "number") usage.inputTokens.cacheRead = tokens.cacheReadInputTokens;
      if (typeof tokens.cacheWriteInputTokens === "number") usage.inputTokens.cacheWrite = tokens.cacheWriteInputTokens;
    }
    while (queue.length) yield queue.shift()!;
  }
  if ([...tools.values()].some((tool) => !tool.done)) throw new Error("Amazon Q stream ended with an incomplete tool call");
  if (!sawMetadata || !contentSeen) throw new Error("Amazon Q stream ended without a completed response");
  text.flush();
  closeBlock();
  while (queue.length) yield queue.shift()!;
  const raw = stopReason?.toUpperCase();
  const unified = raw === "MAX_TOKENS" || raw === "MAX_TOKENS_REACHED" ? "length"
    : raw === "CONTENT_FILTERED" || raw === "GUARDRAIL_INTERVENED" ? "content-filter"
    : tools.size ? "tool-calls" : raw === "END_TURN" || raw === "STOP_SEQUENCE" ? "stop" : "other";
  yield { type: "finish", finishReason: { unified, raw: stopReason }, usage, providerMetadata: { "amazon-q": metadata } };
}

export class AmazonQLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = "v4" as const;
  readonly provider = "amazon-q";
  readonly supportedUrls = {};
  constructor(readonly modelId: string, private readonly client: AmazonQClient) {}

  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const model = (await this.client.models(options.abortSignal)).find((m) => m.modelId === this.modelId);
    if (!model) throw new Error(`Amazon Q model is unavailable for this API key: ${this.modelId}`);
    const { body, names, declared } = amazonQPrompt(model, options);
    const warnings: SharedV4Warning[] = [];
    for (const feature of ["topK", "seed", "presencePenalty", "frequencyPenalty", "stopSequences"] as const) {
      if (options[feature] != null) warnings.push({ type: "unsupported", feature });
    }
    const response = await this.client.request("GenerateAssistantResponse", body, options.abortSignal, options.headers);
    if (!response.body || !response.headers.get("content-type")?.includes("eventstream")) {
      await response.body?.cancel();
      throw new Error("Amazon Q did not return an AWS EventStream response");
    }
    const reader = response.body.getReader();
    const events = translatedEvents(reader, names, declared, options);
    let started = false;
    return {
      stream: new ReadableStream<Part>({
        async pull(controller) {
          try {
            if (!started) { started = true; controller.enqueue({ type: "stream-start", warnings }); return; }
            const result = await events.next();
            if (result.done) controller.close();
            else controller.enqueue(result.value);
          } catch (error) { controller.error(error); }
        },
        async cancel() { await reader.cancel().catch(() => {}); await events.return(undefined); },
      }),
      response: { headers: Object.fromEntries(response.headers.entries()) },
    };
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const result = await this.doStream(options);
    const reader = result.stream.getReader();
    const content: LanguageModelV4Content[] = [];
    const blocks = new Map<string, { type: "text" | "reasoning"; text: string }>();
    let finish: Extract<Part, { type: "finish" }> | undefined;
    let warnings: SharedV4Warning[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-start" || value.type === "reasoning-start") {
          const block = { type: value.type === "text-start" ? "text" as const : "reasoning" as const, text: "" };
          content.push(block); blocks.set(value.id, block);
        } else if (value.type === "text-delta" || value.type === "reasoning-delta") {
          const block = blocks.get(value.id);
          if (block) block.text += value.delta;
        } else if (value.type === "tool-call") content.push(value);
        else if (value.type === "finish") finish = value;
        else if (value.type === "stream-start") warnings = value.warnings;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!finish) throw new Error("Amazon Q stream is missing its finish event");
    return { content, warnings, finishReason: finish.finishReason, usage: finish.usage, providerMetadata: finish.providerMetadata, response: result.response };
  }
}
