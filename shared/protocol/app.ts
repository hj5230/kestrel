// App-wide state: the phone remote, usage, search, history indexing, and the server's event stream.
import type { AssistantMsg, StoredMessage } from "./messages";
import type { ApprovalRequest, QuestionRequest } from "./requests";
import type { RunPhase, SessionInfo, CompactionInfo, QueuedMessage } from "./sessions";
import type { McpServerStatus } from "./settings";

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
  | { type: "phase"; sessionId: string; phase: RunPhase | null }
  | { type: "mcp_status"; servers: McpServerStatus[] }
  | { type: "memory_changed" }
  | { type: "models_updated" }
  | { type: "notice"; sessionId?: string; level: "info" | "warn" | "error"; text: string }
  | { type: "run_finished"; sessionId: string; title: string; ok: boolean }
  | { type: "remote_status"; status: RemoteStatus };

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
