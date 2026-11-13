// App settings and the extensions they configure: MCP servers, skills, slash commands and memory.
import type { ThinkingLevel, PermissionMode, Language, TranscriptView } from "./models";
import type { LogVerbosity } from "./log";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  state: "disabled" | "connecting" | "connected" | "error";
  error: string | null;
  tools: { name: string; description: string }[];
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: string;
}

/** What a memory is about; steers what the agent saves and how the settings page groups it. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryModelEndpoint {
  url: string;
  model: string;
  apiKey: string;
}

export interface MemoryEmbeddingEndpoint extends MemoryModelEndpoint {
  api: "ollama" | "openai";
}

export interface MemoryStatus {
  state: "disabled" | "unconfigured" | "indexing" | "ready" | "error";
  total: number;
  indexed: number;
  error: string | null;
  pending: number;
  failed: number;
  saveError: string | null;
  migrated: number;
}

export interface MemoryEvidence {
  sessionId: string;
  seq: number;
  quote: string;
}

export interface MemorySummary {
  /** Stable identity, preserved when a note is moved or renamed. */
  id: string;
  locator: string;
  revision: string;
  aliases: string[];
  topic: string;
  name: string;
  type: MemoryType;
  /** One line shown in the agent's index; decides whether the agent opens the memory. */
  description: string;
  /** Session that created it, when it was saved during a chat. */
  source: string;
  modifiedAt: number;
}

export interface MemoryEntry extends MemorySummary {
  content: string;
  evidence: MemoryEvidence[];
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  kind: "builtin" | "prompt" | "skill";
  source?: string;
}

export interface AppSettings {
  language: Language;
  theme: "system" | "light" | "dark";
  accent: "neutral" | "blue" | "violet" | "emerald" | "orange" | "rose";
  defaultCwd: string;
  defaultProviderId: string;
  defaultModelId: string;
  defaultThinking: ThinkingLevel;
  defaultPermissionMode: PermissionMode;
  /** `providerId::modelId` that names new sessions; empty = the session's own model. */
  titleModel: string;
  /** `providerId::modelId` that summarizes old turns when the context fills up; empty = the session's own model. */
  compactModel: string;
  /** Other apps whose conversations the agent may search: "claude-code", "codex", "cursor". */
  historySources: string[];
  autoCompact: boolean;
  compactThreshold: number;
  keepRecentTokens: number;
  systemPromptAppend: string;
  instructionFiles: string[];
  loadProjectInstructions: boolean;
  skillDirs: string[];
  disabledSkills: string[];
  commandDirs: string[];
  /** Agent keeps notes across sessions (~/.kestrel/memory): reads them at start and can add, change and delete. */
  memoryEnabled: boolean;
  /** Agent may save on its own judgement; off means only when the user asks it to remember something. */
  memoryAutoSave: boolean;
  memoryEmbedding: MemoryEmbeddingEndpoint;
  memoryReranker: MemoryModelEndpoint;
  /** Normalized reranker score required for automatic full-text disclosure. */
  memoryMinScore: number;
  proxyMode: "env" | "none" | "custom";
  proxyUrl: string;
  /** Tavily API key. The web_search tool exists only while this is set. */
  tavilyApiKey: string;
  bashTimeoutSec: number;
  /** ffmpeg used to convert pictures the webview can't decode; empty = found on PATH or in Homebrew's folders. */
  ffmpegPath: string;
  bashWhitelist: string[];
  toolWhitelist: string[];
  /** `providerId::modelId` of the model that reviews calls in auto mode; empty = no reviewer, unclear calls are asked. */
  autoModel: string;
  /** Auto-review policy, appended to the built-in one: what counts as trusted (repos, hosts, buckets). */
  autoEnvironment: string;
  /** Extra things the reviewer must block. */
  autoBlockRules: string;
  /** Exceptions: things the reviewer must allow even though a block rule matches. */
  autoAllowRules: string;
  notifyOnFinish: boolean;
  sendKey: "enter" | "mod-enter";
  transcriptView: TranscriptView;
  remoteEnabled: boolean;
  remotePort: number;
  /** Look for a new version at launch and every few hours, and download it in the background. */
  updateAutoCheck: boolean;
  /** beta: every published build; stable: only releases without a pre-release tag. */
  updateChannel: "beta" | "stable";
  /** normal: info and above; verbose: also debug. Warnings and errors are always logged and kept longer. */
  logLevel: LogVerbosity;
}
