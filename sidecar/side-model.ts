// Calls the agent makes outside the main loop (session titles, context compaction, auto review).
// Each can run on its own model, set in Settings; the token usage is billed to the model that ran.
import type { ModelConfig } from "../shared/protocol";
import * as store from "./db";
import { resolveModel } from "./providers";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Token counts from an AI SDK result, with cached tokens split out from fresh input. */
export function usageOf(u: any): Usage {
  const cacheRead = u?.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = u?.inputTokenDetails?.cacheWriteTokens ?? 0;
  return {
    input: u?.inputTokenDetails?.noCacheTokens ?? Math.max(0, (u?.inputTokens ?? 0) - cacheRead - cacheWrite),
    output: u?.outputTokens ?? 0,
    cacheRead,
    cacheWrite,
  };
}

export const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });

/** `providerId::modelId` from settings; null when empty or malformed. */
export function parseModelSetting(value: string | undefined): { providerId: string; modelId: string } | null {
  const i = (value ?? "").indexOf("::");
  if (i <= 0) return null;
  return { providerId: value!.slice(0, i), modelId: value!.slice(i + 2) };
}

/**
 * The model for a side task: the one chosen in Settings, or the session's own when none is chosen or
 * the chosen provider has since been removed.
 */
export function sideModel(setting: string | undefined, session: { providerId: string; modelId: string }): { providerId: string; modelId: string; config: ModelConfig } {
  const picked = parseModelSetting(setting);
  const ref = picked && store.getProvider(picked.providerId) ? picked : { providerId: session.providerId, modelId: session.modelId };
  return { ...ref, config: resolveModel(ref.providerId, ref.modelId) };
}

export const costOf = (u: Usage, m: ModelConfig) => (u.input * m.cost.input + u.output * m.cost.output + u.cacheRead * m.cost.cacheRead + u.cacheWrite * m.cost.cacheWrite) / 1e6;

/** Books a side call against the session (so it shows in its cost) and in the usage statistics. */
export function recordSideUsage(sessionId: string, purpose: "title" | "compaction" | "review", model: { providerId: string; modelId: string }, usage: Usage) {
  if (!usage.input && !usage.output && !usage.cacheRead && !usage.cacheWrite) return;
  let cost = 0;
  try {
    cost = costOf(usage, resolveModel(model.providerId, model.modelId));
  } catch {}
  store.recordUsage({ sessionId, providerId: model.providerId, modelId: model.modelId, ...usage, cost, purpose });
  store.addSessionUsage(sessionId, { ...usage, cost }, null);
}
