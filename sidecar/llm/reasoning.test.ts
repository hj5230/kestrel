import { expect, test } from "bun:test";
import { reasoningRequest } from "./reasoning";

test("each provider gets its own field, and an unknown level is left off", () => {
  expect(reasoningRequest("openai-compatible", "ultra")).toEqual({ providerOptions: { compatible: { reasoningEffort: "ultra" } } });
  expect(reasoningRequest("openai", "max")).toEqual({ providerOptions: { openai: { reasoningEffort: "max" } } });
  expect(reasoningRequest("anthropic", "xhigh")).toEqual({ providerOptions: { anthropic: { effort: "xhigh" } } });
  expect(reasoningRequest("anthropic", "none")).toEqual({ reasoning: "none" });
  expect(reasoningRequest("anthropic", "ultra")).toBeUndefined();
  expect(reasoningRequest("google", "low")).toEqual({ providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } });
  expect(reasoningRequest("deepseek", "max")).toEqual({ providerOptions: { deepseek: { reasoningEffort: "max" } } });
  expect(reasoningRequest("deepseek", "none")).toEqual({ providerOptions: { deepseek: { thinking: { type: "disabled" } } } });
  expect(reasoningRequest("openrouter", "high")).toEqual({ providerOptions: { openrouter: { reasoningEffort: "high" } } });
});
