// Images in tool results must reach the model as images. The OpenAI-compatible adapter JSON-encodes a
// result with image parts, which sent a screenshot as megabytes of base64 text and overflowed the context.
import { expect, test } from "bun:test";
import type { Message, Model } from "@mariozechner/pi-ai";
import { toModelMessages } from "./llm/vercel-messages";

const model = (vision: boolean) => ({ id: "m", provider: "p", api: "vercel-ai", input: vision ? ["text", "image"] : ["text"] }) as unknown as Model<any>;
const big = "A".repeat(500_000);
const history: Message[] = [
  { role: "user", content: "look at these", timestamp: 0 },
  {
    role: "assistant", provider: "p", model: "m", api: "vercel-ai", stopReason: "toolUse", timestamp: 0, usage: {} as any,
    content: [{ type: "toolCall", id: "a", name: "read", arguments: { path: "1.png" } }, { type: "toolCall", id: "b", name: "read", arguments: { path: "2.png" } }],
  },
  { role: "toolResult", toolCallId: "a", toolName: "read", isError: false, timestamp: 0, content: [{ type: "text", text: "Image 1.png" }, { type: "image", data: big, mimeType: "image/png" }] },
  { role: "toolResult", toolCallId: "b", toolName: "read", isError: false, timestamp: 0, content: [{ type: "text", text: "Image 2.png" }, { type: "image", data: big, mimeType: "image/png" }] },
];

const textSize = (msgs: unknown) => JSON.stringify(msgs, (k, v) => (k === "image" || k === "data" ? undefined : v)).length;

test("adapters that support it get the images inside the tool results", () => {
  const out = toModelMessages(history, model(true), { imagesInToolResults: true });
  expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  const parts = (out[2].content as any[]).map((p) => p.output.type);
  expect(parts).toEqual(["content", "content"]);
});

test("for the others the images follow the results as one user message, never as text", () => {
  const out = toModelMessages(history, model(true), { imagesInToolResults: false });
  expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
  const results = out[2].content as any[];
  expect(results.map((p) => p.output.type)).toEqual(["text", "text"]);
  expect(results[0].output.value).toContain("Image 1.png");
  const images = (out[3].content as any[]).filter((p) => p.type === "image");
  expect(images.length).toBe(2);
  expect(textSize(out)).toBeLessThan(2000);
});

test("a model without vision gets a note instead of the image", () => {
  const out = toModelMessages(history, model(false), { imagesInToolResults: false });
  expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  expect((out[2].content as any[])[0].output.value).toContain("image omitted");
  expect(JSON.stringify(out).length).toBeLessThan(2000);
});
