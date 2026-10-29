import { expect, test } from "bun:test";
import { resolveThinking } from "../shared/effort";
import { installCatalog, lookupFacts, modelKeys, planBackfill, type CatalogFacts } from "./catalog";
import type { ModelConfig } from "../shared/protocol";

const none = new Map();

function model(patch: Partial<ModelConfig> = {}): ModelConfig {
  return {
    providerId: "p",
    id: "gpt-6-sol",
    name: "gpt-6-sol",
    contextWindow: 128_000,
    maxTokens: 16_384,
    reasoning: false,
    vision: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    enabled: true,
    efforts: null,
    ...patch,
  };
}

installCatalog({
  moonshotai: {
    api: "https://api.moonshot.ai/v1",
    models: {
      "kimi-k3": {
        name: "Kimi K3",
        reasoning: true,
        limit: { context: 1_048_576, output: 32_000 },
        cost: { input: 3, output: 15 },
        reasoning_options: [{ type: "effort", values: ["max", "low", "high"] }],
      },
    },
  },
  "kimi-code": {
    api: "https://api.kimi.com/coding/v1",
    models: {
      k3: {
        name: "K3 plan",
        reasoning: true,
        limit: { context: 262_144, output: 8_000 },
        reasoning_options: [{ type: "effort", values: ["none", "low", "high", "max"] }],
      },
    },
  },
  openai: {
    models: {
      "gpt-6-sol": {
        name: "GPT-6 Sol",
        reasoning: true,
        limit: { context: 1_050_000, output: 128_000 },
        cost: { input: 2, output: 10, cache_read: 0.2 },
        modalities: { input: ["text", "image/png"] },
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
      },
    },
  },
  anthropic: {
    models: {
      "claude-sonnet-5-5": {
        name: "Sonnet",
        reasoning: true,
        limit: { context: 200_000, output: 64_000 },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      },
    },
  },
  google: {
    models: {
      "gemini-2.5-pro": {
        name: "Gemini 2.5 Pro",
        reasoning: true,
        limit: { context: 1_048_576, output: 65_536 },
        reasoning_options: [{ type: "budget_tokens", min: 128, max: 32_768 }],
      },
    },
  },
});

test("ids drop the vendor, the long-context mark and a date", () => {
  expect(modelKeys("openai/gpt-6-sol")).toEqual(["openai/gpt-6-sol", "gpt-6-sol"]);
  expect(modelKeys("claude-sonnet-5-5[1m]")).toContain("claude-sonnet-5-5");
  expect(modelKeys("claude-sonnet-4-5-20251101")).toContain("claude-sonnet-4-5");
});

test("the endpoint decides the effort list, not the model family", () => {
  const official = lookupFacts("openai-compatible", "https://api.moonshot.ai/v1", "kimi-k3", none);
  const plan = lookupFacts("openai-compatible", "https://api.kimi.com/coding/v1/", "k3", none);
  expect(official?.efforts).toEqual(["low", "high", "max"]);
  expect(official?.name).toBe("Kimi K3");
  expect(plan?.efforts).toEqual(["none", "low", "high", "max"]);
  expect(plan?.contextWindow).toBe(262_144);
});

test("a Codex subscription slug keeps the cache's context and efforts, and the catalog's price", () => {
  const codex = new Map([["gpt-6-sol", { contextWindow: 272_000, vision: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], effortDefault: "medium" }]]);
  const facts = lookupFacts("openai-compatible", "http://127.0.0.1:3456/v1", "gpt-6-sol", codex);
  expect(facts?.contextWindow).toBe(272_000);
  expect(facts?.efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  expect(facts?.effortDefault).toBe("medium");
  expect(facts?.cost).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 });
  expect(facts?.maxTokens).toBe(128_000);
});

test("a long-context suffix raises the window, and a budget model has no effort list", () => {
  const claude = lookupFacts("openai-compatible", "", "claude-sonnet-5-5[1m]", none);
  expect(claude?.contextWindow).toBe(1_000_000);
  expect(claude?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  const gemini = lookupFacts("google", "", "gemini-2.5-pro", none);
  expect(gemini?.reasoning).toBe(true);
  expect(gemini?.efforts).toEqual([]);
});

test("backfill writes defaults and locks a hand-edited window", () => {
  const facts: CatalogFacts = {
    contextWindow: 272_000,
    maxTokens: 32_000,
    reasoning: true,
    vision: true,
    cost: { input: 2, output: 10, cacheRead: 0, cacheWrite: 0 },
    efforts: ["low", "high", "max"],
    effortDefault: "high",
  };
  const filled = planBackfill(model(), facts);
  expect(filled?.contextWindow).toBe(272_000);
  expect(filled?.cost.input).toBe(2);
  expect(filled?.efforts).toEqual(["low", "high", "max"]);
  expect(filled?.effortDefault).toBe("high");
  expect(filled?.reasoning).toBe(true);
  expect(filled?.locked ?? []).not.toContain("contextWindow");

  const kept = planBackfill(model({ contextWindow: 300_000, reasoning: true }), facts);
  expect(kept?.contextWindow).toBe(300_000);
  expect(kept?.locked).toContain("contextWindow");
  expect(kept?.efforts).toEqual(["low", "high", "max"]);
});

test("an unknown level is not rewritten to a neighbor", () => {
  expect(resolveThinking("medium", ["low", "high", "max"], "high")).toBe("high");
  expect(resolveThinking("medium", ["low", "high", "max"], null)).toBe(null);
  expect(resolveThinking("off", ["none", "low", "high"], null)).toBe("none");
  expect(resolveThinking("max", ["low", "high", "max"], null)).toBe("max");
  expect(resolveThinking("high", [], null)).toBe(null);
});


test("catalog changes update previously automatic fields without locking them", () => {
  const first = planBackfill(model(), { contextWindow: 200000, efforts: ["low", "high"], reasoning: true })!;
  const next = planBackfill(first, { contextWindow: 300000, efforts: ["low", "high", "max"], reasoning: true })!;
  expect(next.contextWindow).toBe(300000);
  expect(next.efforts).toEqual(["low", "high", "max"]);
  expect(next.locked).not.toContain("contextWindow");
  expect(next.locked).not.toContain("efforts");
});

test("manual zero prices and explicit locks survive a catalog revision", () => {
  const current = model({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, locked: ["cost"] });
  const next = planBackfill(current, { cost: { input: 5, output: 20, cacheRead: 1, cacheWrite: 2 }, efforts: [] })!;
  expect(next.cost.input).toBe(0);
  expect(next.locked).toContain("cost");
});
