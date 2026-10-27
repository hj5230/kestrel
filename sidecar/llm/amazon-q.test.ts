// Exercise the SDK contract against real AWS frames, including corruption and fragmented tool input.
import { expect, test } from "bun:test";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { AmazonQClient, eventCodec, amazonQEfforts } from "./amazon-q-api";
import { amazonQPrompt, amazonQToolName } from "./amazon-q-prompt";
import { AmazonQLanguageModel } from "./amazon-q";
import { validateMemoryInput } from "../memory";

const model = { modelId: "claude-haiku-4.5", tokenLimits: { maxInputTokens: 200_000, maxOutputTokens: 64_000 } };
const prompt: LanguageModelV4CallOptions = { prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] };
const frame = (type: string, data: unknown, exception = false) => eventCodec.encode({
  headers: { ":message-type": { type: "string", value: exception ? "exception" : "event" }, ":event-type": { type: "string", value: type } },
  body: new TextEncoder().encode(JSON.stringify(data)),
});
function response(frames: Uint8Array[], fragment = 7) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const bytes of frames) for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.slice(i, i + fragment));
      controller.close();
    },
  }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
}
const finish = () => frame("metadataEvent", { stopReason: "END_TURN" });

test("Amazon Q credentials are rejected by the memory secret guard", () => {
  expect(() => validateMemoryInput({ topic: "projects", name: "amazon-q", type: "reference", description: "Amazon Q credential", content: "ksk_" + "x".repeat(32) })).toThrow("API key");
});

test("API-key authentication sends any supplied key unchanged without checking its prefix", async () => {
  for (const apiKey of ["ksk_example", "qsk_example", "opaque-example"]) {
    const api = new AmazonQClient({ apiKey, fetch: async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
      expect(new Headers(init?.headers).get("tokentype")).toBe("API_KEY");
      return Response.json({ models: [model] });
    } });
    expect(await api.models()).toHaveLength(1);
  }
});
const textResponse = (text: string) => response([frame("assistantResponseEvent", { content: text }), finish()]);
function client(handle: (body: any, headers: Headers) => Response | Promise<Response>) {
  return new AmazonQClient({ apiKey: "ksk_test", fetch: (async (_url, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get("x-amz-target")?.endsWith("ListAvailableModels")) return Response.json({ models: [model] });
    return handle(JSON.parse(String(init?.body)), headers);
  }) });
}

test("SDK generation decodes split UTF-8 frames and preserves literal JSON in text", async () => {
  const message = '你好 {"name":"read","toolUseId":"fake"} <div';
  const result = await generateText({ model: new AmazonQLanguageModel(model.modelId, client((_body, headers) => {
    expect(headers.get("tokentype")).toBe("API_KEY");
    expect(headers.get("authorization")).toBe("Bearer ksk_test");
    return textResponse(message);
  })), prompt: "hello", maxRetries: 0 });
  expect(result.text).toBe(message);
  expect(result.toolCalls).toHaveLength(0);
});

test("SDK tool loop restores long tool names, fragmented arguments, and paired results", async () => {
  const name = "mcp_" + "long_tool_name_".repeat(7);
  let calls = 0;
  const wire = amazonQToolName(name);
  const lm = new AmazonQLanguageModel(model.modelId, client((body) => {
    calls++;
    const context = body.conversationState.currentMessage.userInputMessage.userInputMessageContext;
    expect(context.tools[0].toolSpecification.name).toBe(wire);
    if (calls === 1) return response([
      frame("toolUseEvent", { name: wire, toolUseId: "call-1", input: {} }),
      frame("toolUseEvent", { input: '{"value":' }),
      frame("toolUseEvent", { input: "41}", stop: true }),
      frame("metadataEvent", { stopReason: "TOOL_USE" }),
    ]);
    expect(context.toolResults).toEqual([{ toolUseId: "call-1", content: [{ text: "42" }], status: "success" }]);
    expect(body.conversationState.history[1].assistantResponseMessage.toolUses[0].input).toEqual({ value: 41 });
    return textResponse("42");
  }));
  let executed = 0;
  const result = await generateText({ model: lm, prompt: "Use the tool", maxRetries: 0, stopWhen: stepCountIs(3), tools: {
    [name]: tool({ description: "Increment", inputSchema: jsonSchema<{ value: number }>({ type: "object", properties: { value: { type: "number" } }, required: ["value"] }), execute: ({ value }) => { executed++; return value + 1; } }),
  } });
  expect(result.text).toBe("42");
  expect(executed).toBe(1);
  expect(calls).toBe(2);
});

test("interleaved parallel tools retain their own JSON fragments", async () => {
  const lm = new AmazonQLanguageModel(model.modelId, client(() => response([
    frame("toolUseEvent", { name: "read", toolUseId: "a", input: '{"path":' }),
    frame("toolUseEvent", { name: "read", toolUseId: "b", input: '{"path":' }),
    frame("toolUseEvent", { toolUseId: "a", input: '"one"}', stop: true }),
    frame("toolUseEvent", { toolUseId: "b", input: '"two"}', stop: true }), finish(),
  ])));
  const result = await lm.doGenerate({ ...prompt, tools: [{ type: "function", name: "read", inputSchema: { type: "object" } }] });
  expect(result.content.filter((p) => p.type === "tool-call").map((p) => [p.toolCallId, JSON.parse(p.input)])).toEqual([["a", { path: "one" }], ["b", { path: "two" }]]);
});

test("thinking tag splits are separate reasoning and HTML tails survive flushing", async () => {
  const lm = new AmazonQLanguageModel(model.modelId, client(() => response([
    ...["<thi", "nking>分析", "</think", "ing>OK<"].map((content) => frame("assistantResponseEvent", { content })), finish(),
  ])));
  const result = await lm.doGenerate(prompt);
  expect(result.content).toEqual([{ type: "reasoning", text: "分析" }, { type: "text", text: "OK<" }]);
});

test("corrupt CRCs, truncated frames and in-band exceptions fail instead of completing", async () => {
  const corrupt = frame("assistantResponseEvent", { content: "bad" });
  corrupt[corrupt.length - 1] ^= 1;
  for (const frames of [[corrupt], [finish().slice(0, -1)], [frame("AccessDeniedException", { message: "denied" }, true)]]) {
    const lm = new AmazonQLanguageModel(model.modelId, client(() => response(frames)));
    await expect(lm.doGenerate(prompt)).rejects.toThrow();
  }
});

test("malformed or unfinished tools are never emitted as empty successful calls", async () => {
  for (const events of [
    [frame("toolUseEvent", { name: "read", toolUseId: "a", input: '{"path":', stop: true })],
    [frame("toolUseEvent", { name: "read", toolUseId: "a", input: "{}" })],
  ]) {
    const lm = new AmazonQLanguageModel(model.modelId, client(() => response([...events, finish()])));
    await expect(lm.doGenerate({ ...prompt, tools: [{ type: "function", name: "read", inputSchema: { type: "object" } }] })).rejects.toThrow();
  }
});

test("discovery failures do not cache a fallback or leak the key into HTTP diagnostics", async () => {
  let calls = 0;
  const api = new AmazonQClient({ apiKey: "ksk_private", fetch: (async () => {
    calls++;
    if (calls === 1) return new Response("invalid ksk_private", { status: 403 });
    return Response.json({ models: [model] });
  }) });
  await expect(api.models()).rejects.toThrow("invalid [REDACTED]");
  expect((await api.models())[0]?.modelId).toBe(model.modelId);
  expect(calls).toBe(2);
});

test("system and memory text survive normalization; tool results and images keep their association", () => {
  const result = amazonQPrompt(model, { prompt: [
    { role: "system", content: "System rules" },
    { role: "user", content: [{ type: "text", text: "Memory context\nQuestion" }, { type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array([1, 2]) } }] },
    { role: "assistant", content: [{ type: "tool-call", toolName: "read", toolCallId: "a", input: { path: "/a" } }] },
    { role: "tool", content: [{ type: "tool-result", toolName: "read", toolCallId: "a", output: { type: "error-text", value: "missing" } }] },
  ] });
  const state = result.body.conversationState;
  expect((state.history![0] as any).userInputMessage.content).toBe("System rules\n\nMemory context\nQuestion");
  expect((state.history![0] as any).userInputMessage.images[0].source.bytes).toBe("AQI=");
  expect(state.currentMessage.userInputMessage.userInputMessageContext?.toolResults?.[0]?.status).toBe("error");
  expect(JSON.stringify(result.body)).not.toContain("execution_discipline");
});

test("efforts use the model's live schema and unsupported values fail explicitly", () => {
  const reasoning = { ...model, additionalModelRequestFieldsSchema: { properties: { reasoning: { properties: { effort: { enum: ["none", "high", "max"], default: "high" } } } } } };
  expect(amazonQEfforts(reasoning)).toEqual({ efforts: ["none", "high", "max"], effortDefault: "high" });
  expect(amazonQPrompt(reasoning, { ...prompt, providerOptions: { "amazon-q": { reasoningEffort: "max" } } }).body.additionalModelRequestFields).toEqual({ reasoning: { effort: "max" } });
  expect(() => amazonQPrompt(reasoning, { ...prompt, reasoning: "low" })).toThrow("Amazon Q reasoning effort");
});

test("aborting a consumer does not poison concurrent shared model discovery", async () => {
  let calls = 0;
  const api = new AmazonQClient({ apiKey: "ksk_test", fetch: (async () => {
    calls++;
    await Bun.sleep(20);
    return Response.json({ models: [model] });
  }) });
  const controller = new AbortController();
  const cancelled = api.models(controller.signal);
  const surviving = api.models();
  controller.abort(new Error("cancelled"));
  await expect(cancelled).rejects.toThrow("cancelled");
  expect(await surviving).toHaveLength(1);
  expect(calls).toBe(1);
});
