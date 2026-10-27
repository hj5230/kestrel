// Translate SDK prompts using the API-key wire format documented by pi-kiro-api (see third-party notices).
import { createHash } from "node:crypto";
import { UnsupportedFunctionalityError, type LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { amazonQEfforts, type AmazonQModelInfo } from "./amazon-q-api";

interface ToolUse { toolUseId: string; name: string; input: unknown }
interface ToolResult { toolUseId: string; content: { text: string }[]; status: "success" | "error" }
interface UserInput {
  content: string;
  modelId: string;
  origin: "AI_EDITOR";
  images?: { format: string; source: { bytes: string } }[];
  userInputMessageContext?: { toolResults?: ToolResult[]; tools?: unknown[] };
}
type Turn = { userInputMessage: UserInput } | { assistantResponseMessage: { content: string; toolUses?: ToolUse[] } };

export function amazonQToolName(name: string): string {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return name;
  return `${name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 51)}_${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
}

function modelFields(model: AmazonQModelInfo, effort: unknown): Record<string, unknown> | undefined {
  if (effort == null || effort === "provider-default") return undefined;
  if (typeof effort !== "string") throw new Error("Invalid Amazon Q reasoning effort");
  const props = model.additionalModelRequestFieldsSchema?.properties;
  const supported = amazonQEfforts(model).efforts;
  if (supported.includes(effort)) {
    if (props?.output_config) return { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } };
    return { reasoning: { effort } };
  }
  if (effort === "none" && props?.thinking?.properties?.type?.enum?.includes("disabled")) {
    return { thinking: { type: "disabled" } };
  }
  throw new UnsupportedFunctionalityError({ functionality: `Amazon Q reasoning effort '${effort}' for ${model.modelId}` });
}

export function amazonQPrompt(model: AmazonQModelInfo, options: LanguageModelV4CallOptions) {
  if (options.responseFormat?.type === "json") throw new UnsupportedFunctionalityError({ functionality: "Amazon Q structured output" });
  if (options.toolChoice && !["auto", "none"].includes(options.toolChoice.type)) {
    throw new UnsupportedFunctionalityError({ functionality: "Amazon Q forced tool choice" });
  }
  const turns: Turn[] = [];
  const system: string[] = [];
  const names = new Map<string, string>();
  const declared = new Set<string>();
  const nameFor = (name: string) => {
    const mapped = amazonQToolName(name);
    if (names.has(mapped) && names.get(mapped) !== name) throw new Error("Amazon Q tool name collision");
    names.set(mapped, name);
    return mapped;
  };
  const user = (): UserInput => {
    const previous = turns.at(-1);
    if (previous && "userInputMessage" in previous) return previous.userInputMessage;
    const message: UserInput = { content: "", modelId: model.modelId, origin: "AI_EDITOR" };
    turns.push({ userInputMessage: message });
    return message;
  };
  const text = (message: { content: string }, value: string) => { message.content += (message.content ? "\n\n" : "") + value; };
  const tools = options.toolChoice?.type === "none" ? [] : (options.tools ?? []).map((tool) => {
    if (tool.type !== "function") throw new UnsupportedFunctionalityError({ functionality: "Amazon Q provider tools" });
    const name = nameFor(tool.name);
    declared.add(name);
    return { toolSpecification: { name, description: tool.description || tool.name, inputSchema: { json: tool.inputSchema } } };
  });

  for (const message of options.prompt) {
    if (message.role === "system") { system.push(message.content); continue; }
    if (message.role === "user") {
      const target = user();
      for (const part of message.content) {
        if (part.type === "text") text(target, part.text);
        else if (part.type === "file") {
          const format = part.mediaType.replace("image/", "").replace("jpg", "jpeg");
          if (!["png", "jpeg", "gif", "webp"].includes(format) || part.data.type !== "data") {
            throw new UnsupportedFunctionalityError({ functionality: `Amazon Q file ${part.mediaType}` });
          }
          const bytes = typeof part.data.data === "string" ? part.data.data : Buffer.from(part.data.data).toString("base64");
          (target.images ??= []).push({ format, source: { bytes } });
        }
      }
    } else if (message.role === "assistant") {
      const previous = turns.at(-1);
      const target = previous && "assistantResponseMessage" in previous ? previous.assistantResponseMessage : { content: "" } as { content: string; toolUses?: ToolUse[] };
      if (!previous || !("assistantResponseMessage" in previous)) turns.push({ assistantResponseMessage: target });
      for (const part of message.content) {
        if (part.type === "text") text(target, part.text);
        else if (part.type === "tool-call") (target.toolUses ??= []).push({ toolUseId: part.toolCallId, name: nameFor(part.toolName), input: part.input });
        else if (part.type !== "reasoning") throw new UnsupportedFunctionalityError({ functionality: `Amazon Q assistant ${part.type}` });
      }
    } else if (message.role === "tool") {
      const target = user();
      const context = target.userInputMessageContext ??= {};
      for (const part of message.content) {
        if (part.type !== "tool-result") throw new UnsupportedFunctionalityError({ functionality: "Amazon Q tool approvals" });
        const output = part.output;
        const error = output.type === "execution-denied" || output.type.startsWith("error-");
        let value: string;
        if (output.type === "content") {
          const texts: string[] = [];
          for (const item of output.value) {
            if (item.type === "text") texts.push(item.text);
            else if (item.type === "file") {
              const format = item.mediaType.replace("image/", "").replace("jpg", "jpeg");
              if (!["png", "jpeg", "gif", "webp"].includes(format) || item.data.type !== "data") throw new UnsupportedFunctionalityError({ functionality: `Amazon Q tool image ${item.mediaType}` });
              const bytes = typeof item.data.data === "string" ? item.data.data : Buffer.from(item.data.data).toString("base64");
              (target.images ??= []).push({ format, source: { bytes } });
            } else throw new UnsupportedFunctionalityError({ functionality: `Amazon Q tool result ${item.type}` });
          }
          value = texts.join("\n");
        } else if (output.type === "execution-denied") value = output.reason || "Tool execution denied";
        else value = typeof output.value === "string" ? output.value : JSON.stringify(output.value);
        (context.toolResults ??= []).push({ toolUseId: part.toolCallId, content: [{ text: value || " " }], status: error ? "error" : "success" });
      }
    }
  }
  if (!turns.length || !("userInputMessage" in turns[0]!)) throw new Error("Amazon Q requires a user message before assistant history");
  if (system.length) turns[0].userInputMessage.content = system.join("\n\n") + "\n\n" + turns[0].userInputMessage.content;
  const last = turns.at(-1)!;
  if (!("userInputMessage" in last)) throw new UnsupportedFunctionalityError({ functionality: "Amazon Q assistant prefill" });
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if ("userInputMessage" in turn) {
      turn.userInputMessage.content ||= " ";
      const results = turn.userInputMessage.userInputMessageContext?.toolResults ?? [];
      const previous = turns[i - 1];
      const calls = previous && "assistantResponseMessage" in previous ? previous.assistantResponseMessage.toolUses ?? [] : [];
      if (calls.length !== results.length || new Set(results.map((r) => r.toolUseId)).size !== results.length || calls.some((call) => !results.some((result) => result.toolUseId === call.toolUseId))) {
        throw new Error("Amazon Q tool calls and results must be paired before continuing");
      }
    } else turn.assistantResponseMessage.content ||= " ";
  }
  if (tools.length) (last.userInputMessage.userInputMessageContext ??= {}).tools = tools;
  const requestedId = options.providerOptions?.["amazon-q"]?.conversationId;
  // Stable across tool continuations, with an explicit session id preferred when available.
  const digest = createHash("sha256").update(JSON.stringify(turns[0])).digest("hex");
  const conversationId = typeof requestedId === "string" ? requestedId : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const effort = options.providerOptions?.["amazon-q"]?.reasoningEffort ?? options.reasoning;
  const fields = modelFields(model, effort);
  const inferenceConfig = {
    ...(options.maxOutputTokens != null ? { maxTokens: options.maxOutputTokens } : {}),
    ...(options.temperature != null ? { temperature: options.temperature } : {}),
    ...(options.topP != null ? { topP: options.topP } : {}),
  };
  return {
    names, declared,
    body: {
      conversationState: { chatTriggerType: "MANUAL", agentTaskType: "vibe", conversationId, currentMessage: last, ...(turns.length > 1 ? { history: turns.slice(0, -1) } : {}) },
      agentMode: "vibe",
      ...(Object.keys(inferenceConfig).length ? { inferenceConfig } : {}),
      ...(fields ? { additionalModelRequestFields: fields } : {}),
    },
  };
}
