// An Amazon Q agent reads a file through the same SDK and permission pipeline as normal sessions.
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRunner } from "./agent/runner";
import * as store from "./db";
import { fetchRemoteModels, modelDefaults } from "./providers";
import { createSession } from "./sessions";
import { eventCodec } from "./llm/amazon-q-api";
import type { ProviderConfig } from "../shared/protocol";

let server: ReturnType<typeof Bun.serve>;
let project: string;
let provider: ProviderConfig;
const turns: any[] = [];
const frame = (type: string, data: unknown) => eventCodec.encode({ headers: {
  ":message-type": { type: "string", value: "event" }, ":event-type": { type: "string", value: type },
}, body: new TextEncoder().encode(JSON.stringify(data)) });
const response = (frames: Uint8Array[]) => new Response(new Blob(frames.map((bytes) => new Uint8Array(bytes))), { headers: { "content-type": "application/vnd.amazon.eventstream" } });

beforeAll(async () => {
  store.openDb(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-kiro-data-")), true);
  store.saveSettings({ memoryEnabled: false, memoryAutoSave: false });
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-kiro-project-")));
  fs.writeFileSync(path.join(project, "note.txt"), "Amazon Q pipeline verified\n");
  server = Bun.serve({ port: 0, async fetch(req) {
    expect(req.headers.get("tokentype")).toBe("API_KEY");
    expect(req.headers.get("authorization")).toBe("Bearer qsk_scripted");
    if (req.headers.get("x-amz-target")?.endsWith("ListAvailableModels")) return Response.json({ models: [{
      modelId: "amazon-q-test", modelName: "Amazon Q test", supportedInputTypes: ["TEXT"],
      tokenLimits: { maxInputTokens: 321_000, maxOutputTokens: 12_345 },
    }] });
    const body = await req.json() as any;
    const current = body.conversationState.currentMessage.userInputMessage;
    if (!current.userInputMessageContext?.tools?.length) return response([frame("assistantResponseEvent", { content: "Read a note" }), frame("metadataEvent", { stopReason: "END_TURN" })]);
    turns.push(body);
    const result = current.userInputMessageContext?.toolResults?.find((r: any) => r.toolUseId === "call-read");
    if (result) return response([frame("assistantResponseEvent", { content: result.content[0].text }), frame("metadataEvent", { stopReason: "END_TURN" })]);
    const input = JSON.stringify({ path: path.join(project, "note.txt") });
    return response([
      frame("toolUseEvent", { toolUseId: "call-read", name: "read", input: input.slice(0, 12) }),
      frame("toolUseEvent", { input: input.slice(12), stop: true }),
      frame("metadataEvent", { stopReason: "TOOL_USE" }),
    ]);
  } });
  provider = { id: "amazon-q-scripted", kind: "amazon-q", name: "Amazon Q", baseUrl: `http://127.0.0.1:${server.port}/`, apiKey: "qsk_scripted", headers: {}, enabled: true, createdAt: Date.now() };
  store.upsertProvider(provider);
  const remote = (await fetchRemoteModels(provider))[0]!;
  store.upsertModel({ providerId: provider.id, ...modelDefaults("amazon-q", remote.id, remote.name, remote.contextWindow, remote) });
});
afterAll(() => server.stop(true));

test("authenticated discovery supplies real limits without inheriting public token prices", () => {
  const model = store.getModel(provider.id, "amazon-q-test")!;
  expect(model.contextWindow).toBe(321_000);
  expect(model.maxTokens).toBe(12_345);
  expect(model.reasoning).toBe(false);
  expect(model.vision).toBe(false);
  expect(model.efforts).toEqual([]);
  expect(model.cost.input).toBe(0);
});

test("a full Kestrel agent completes a real file tool round trip over Amazon Q frames", async () => {
  const session = createSession({ cwd: project, providerId: provider.id, modelId: "amazon-q-test", permissionMode: "bypass", thinking: "off" });
  await getRunner(session.id).sendAndWait("Read note.txt and report its contents.");
  const messages = store.loadMessages(session.id).map((m) => m.message as any);
  const result = messages.find((m) => m.role === "toolResult");
  expect(result.isError).toBe(false);
  expect(result.content[0].text).toContain("Amazon Q pipeline verified");
  expect(messages.at(-1).content.some((part: any) => part.text?.includes("Amazon Q pipeline verified"))).toBe(true);
  expect(turns).toHaveLength(2);
  expect(turns[0].conversationState.conversationId).toBe(session.id);
  expect(turns[1].conversationState.conversationId).toBe(session.id);
  expect(store.getSession(session.id)?.lastError).toBeNull();
}, 30_000);
