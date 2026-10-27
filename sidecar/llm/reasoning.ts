// Translates a model's effort string into the request field its provider reads. The AI SDK's
// unified `reasoning` option only covers a fixed scale, so most values go through providerOptions.
import type { ProviderKind } from "../../shared/protocol";

const ANTHROPIC_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);
const GOOGLE_LEVEL = new Set(["minimal", "low", "medium", "high"]);
const DEEPSEEK_EFFORT = new Set(["low", "medium", "high", "xhigh", "max"]);

/** The providerOptions key createProvider uses for this kind. */
export function providerOptionKey(kind: ProviderKind): string {
  if (kind === "openrouter") return "openrouter";
  if (kind === "ollama") return "ollama";
  if (kind === "openai-compatible") return "compatible";
  return kind;
}

export interface ReasoningRequest {
  /** Unified SDK value. Only used to turn thinking off for providers whose effort enum has no `none`. */
  reasoning?: "none";
  providerOptions?: Record<string, any>;
}

/**
 * Puts the model's own effort string on the field that provider accepts.
 * Unknown values are omitted rather than rewritten to a nearby level.
 */
export function reasoningRequest(kind: ProviderKind, level: string): ReasoningRequest | undefined {
  if (!level || level === "off") return undefined;
  const key = providerOptionKey(kind);
  if (level === "none") {
    if (kind === "anthropic" || kind === "google") return { reasoning: "none" };
    if (kind === "deepseek") return { providerOptions: { deepseek: { thinking: { type: "disabled" } } } };
    return { providerOptions: { [key]: { reasoningEffort: "none" } } };
  }
  if (kind === "anthropic") {
    if (!ANTHROPIC_EFFORT.has(level)) return undefined;
    return { providerOptions: { anthropic: { effort: level } } };
  }
  if (kind === "google") {
    if (!GOOGLE_LEVEL.has(level)) return undefined;
    return { providerOptions: { google: { thinkingConfig: { thinkingLevel: level } } } };
  }
  if (kind === "deepseek") {
    if (!DEEPSEEK_EFFORT.has(level)) return undefined;
    return { providerOptions: { deepseek: { reasoningEffort: level } } };
  }
  return { providerOptions: { [key]: { reasoningEffort: level } } };
}
