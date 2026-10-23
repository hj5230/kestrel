export type ProviderKind =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "google"
  | "deepseek"
  | "openrouter"
  | "ollama";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
}

export interface RemoteModel {
  id: string;
  name: string;
  contextWindow?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  known: boolean;
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type SessionStatus = "idle" | "running" | "waiting" | "error";

export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  providerId: string;
  modelId: string;
  thinking: ThinkingLevel;
  permissionMode: PermissionMode;
  pinned: boolean;
  archived: boolean;
  kind: "main" | "subagent";
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  todos: Todo[];
  usage: SessionUsage;
  lastError: string | null;
  messageCount: number;
}

export interface TextBlock {
  type: "text";
  text: string;
  textSignature?: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}
export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}
export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
}

export interface UsageData {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface UserMsg {
  role: "user";
  content: string | (TextBlock | ImageBlock)[];
  timestamp: number;
}
export interface AssistantMsg {
  role: "assistant";
  content: (TextBlock | ThinkingBlock | ToolCallBlock)[];
  provider: string;
  model: string;
  usage: UsageData;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}
export interface ToolResultMsg {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextBlock | ImageBlock)[];
  details?: any;
  isError: boolean;
  timestamp: number;
}
export type ChatMessage = UserMsg | AssistantMsg | ToolResultMsg;

export interface StoredMessage {
  seq: number;
  message: ChatMessage;
}

export interface CompactionInfo {
  id: number;
  cutSeq: number;
  summary: string;
  tokensBefore: number;
  createdAt: number;
  auto: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: any;
  kind: "bash" | "edit" | "tool";
  path: string | null;
  detail: string;
  subagent: boolean;
  whitelistSuggestion: string | null;
  /** Why a person is asked when it is more than "nothing allows this" (credentials, auto-review said no, …). */
  note: ApprovalNote | null;
  createdAt: number;
}

export type ApprovalNoteCode =
  | "protected_path" // a startup file, git hook, credential store or agent config
  | "sensitive_read" // reading credentials
  | "critical_delete" // deleting or moving `/`, the home folder or a folder directly under it
  | "outside_project" // editing a file outside the working folder
  | "review_blocked" // the auto-review model said no and the agent kept pushing
  | "review_error" // the auto-review model could not be reached
  | "review_paused"; // too many blocks in a row: auto mode paused until you approve something

export interface ApprovalNote {
  code: ApprovalNoteCode;
  /** The path or the reviewer's one-line reason. */
  detail?: string;
}

export type ApprovalDecision = "allow_once" | "allow_always" | "deny";

/** A multiple-choice question the agent puts to the user (the `ask_user` tool). */
export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
  /** The agent's suggested choice, shown first and marked. */
  recommended?: boolean;
}

export interface Question {
  id: string;
  prompt: string;
  options: QuestionOption[];
  allowMultiple?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  title?: string;
  questions: Question[];
  createdAt: number;
}

/** One answer per question: the chosen option ids and/or free text (every question also accepts "Other"). */
export interface QuestionAnswer {
  questionId: string;
  optionIds: string[];
  other?: string;
}

/** Stored on the `ask_user` tool result so the transcript can show what was asked and answered. */
export interface AskDetails {
  title?: string;
  questions: Question[];
  /** null: the user dismissed the questions without answering. */
  answers: QuestionAnswer[] | null;
}

export interface SessionDetail {
  session: SessionInfo;
  messages: StoredMessage[];
  compactions: CompactionInfo[];
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  streaming: AssistantMsg | null;
  runningTools: Record<string, { toolName: string; args: any; partial: any; startedAt: number }>;
  queued: QueuedMessage[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  mode: "steer" | "followUp";
}

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

export interface MemorySummary {
  /** `topic/name`; stable key used by the agent tools and the settings page. */
  id: string;
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
  proxyMode: "env" | "none" | "custom";
  proxyUrl: string;
  /** Tavily API key. The web_search tool exists only while this is set. */
  tavilyApiKey: string;
  bashTimeoutSec: number;
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
}

export interface RemoteDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  online: boolean;
}

export interface TailscaleStatus {
  /** not_installed → install; not_running → open the app; needs_login → sign in; stopped → connect. */
  state: "not_installed" | "not_running" | "needs_login" | "stopped" | "running";
  appInstalled: boolean;
  tailnet: string | null;
  dnsName: string | null;
  ips: string[];
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  serverName: string;
  /** SHA-256 of the listener's certificate (lowercase hex); the mobile app pins it. */
  fingerprint: string;
  hosts: string[];
  error: string | null;
  /** Active one-time pairing offer, encoded as a kestrel://pair link for the QR code. */
  pairing: { url: string; expiresAt: number } | null;
  devices: RemoteDevice[];
  tailscale: TailscaleStatus;
  /** System sleep is off (`pmset disablesleep`): the Mac stays online with the lid closed. */
  stayAwake: boolean;
}

export interface UsageSummary {
  totals: { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number; requests: number; sessions: number; toolCalls: number; toolErrors: number };
  daily: { day: string; model: string; cost: number; tokens: number }[];
  byModel: { model: string; provider: string; cost: number; tokens: number; requests: number }[];
  byTool: { tool: string; count: number; errors: number; avgMs: number }[];
  byHour: { weekday: number; hour: number; count: number }[];
  topSessions: { id: string; title: string; cost: number; tokens: number; updatedAt: number }[];
}

export interface SearchHit {
  sessionId: string;
  title: string;
  seq: number;
  role: string;
  snippet: string;
  updatedAt: number;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  home: string;
  platform: string;
  dev: boolean;
  ripgrep: boolean;
  shell: string;
}

export type ServerEvent =
  | { type: "session_updated"; session: SessionInfo }
  | { type: "session_deleted"; id: string }
  | { type: "message_appended"; sessionId: string; stored: StoredMessage }
  | { type: "messages_reset"; sessionId: string }
  | { type: "stream"; sessionId: string; message: AssistantMsg | null }
  | { type: "tool_start"; sessionId: string; toolCallId: string; toolName: string; args: any }
  | { type: "tool_update"; sessionId: string; toolCallId: string; partial: any }
  | { type: "tool_end"; sessionId: string; toolCallId: string }
  | { type: "queue"; sessionId: string; queued: QueuedMessage[] }
  | { type: "approval_request"; request: ApprovalRequest }
  | { type: "approval_resolved"; sessionId: string; id: string }
  | { type: "question_request"; request: QuestionRequest }
  | { type: "question_resolved"; sessionId: string; id: string }
  | { type: "compaction"; sessionId: string; compaction: CompactionInfo }
  | { type: "compacting"; sessionId: string; active: boolean }
  | { type: "mcp_status"; servers: McpServerStatus[] }
  | { type: "memory_changed" }
  | { type: "notice"; sessionId?: string; level: "info" | "warn" | "error"; text: string }
  | { type: "run_finished"; sessionId: string; title: string; ok: boolean }
  | { type: "remote_status"; status: RemoteStatus };

export interface BashDetails {
  command: string;
  output: string;
  exitCode: number | null;
  durationMs: number;
  timedOut?: boolean;
  background?: string;
}

export interface EditDetails {
  path: string;
  diff: string;
  added: number;
  removed: number;
  created?: boolean;
}

export interface SubagentDetails {
  sessionId: string;
  status: "running" | "done" | "error";
  lastActivity: string;
  toolCalls: number;
}

export interface HistorySourceStatus {
  id: string;
  label: string;
  /** Where the app keeps its sessions, `~`-shortened. */
  root: string;
  found: boolean;
  enabled: boolean;
  sessions: number;
  messages: number;
}

/** Progress of indexing other apps' conversations (see `AppSettings.historySources`). */
export interface HistoryStatus {
  sources: HistorySourceStatus[];
  indexing: boolean;
  progress: { done: number; total: number };
}
