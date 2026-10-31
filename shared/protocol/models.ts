// Providers, models and the per-session choices made with them (thinking level, permission mode).

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "google"
  | "deepseek"
  | "openrouter"
  | "amazon-q"
  | "ollama";

/**
 * An effort value exactly as the model accepts it (`low`, `max`, `none`, `ultra`, …).
 * `off` is the legacy spelling of `none`.
 */
export type ThinkingLevel = string;

/**
 * manual      — ask before every edit, command and MCP call.
 * acceptEdits — edits in the project go through, commands are asked.
 * auto        — rules and the allowlist decide what is clearly fine; an auto-review model judges the rest.
 * bypass      — never ask.
 */
export type PermissionMode = "manual" | "acceptEdits" | "auto" | "bypass";

export type Language = "en" | "zh-CN";

export type TranscriptView = "answer" | "compact" | "detailed" | "verbose";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface ModelConfig {
  providerId: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  enabled: boolean;
  /**
   * Effort values this model actually accepts, weakest first.
   * `null` means we have not looked it up yet. An empty list means it has no effort enum.
   */
  efforts?: string[] | null;
  /** The model's own default, when the catalog names one and it is in `efforts`. */
  effortDefault?: string | null;
  /** Fields a person set to something other than the catalog, so a refresh does not overwrite them. */
  locked?: string[];
  /** Local Codex subscription facts are opt-in, never inferred from the model ID. */
  metadataSource?: "catalog" | "codex";
  /** Last values supplied automatically; enables refresh without mistaking old facts for edits. */
  metadata?: {
    source: "catalog" | "codex" | "endpoint";
    checkedAt: number;
    values: Partial<Pick<ModelConfig, "contextWindow" | "maxTokens" | "reasoning" | "vision" | "cost" | "efforts" | "effortDefault">>;
  };
}

export interface RemoteModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  efforts?: string[];
  effortDefault?: string;
  known: boolean;
}
