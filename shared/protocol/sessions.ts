// Sessions: their record, live state while running, and what the transcript view loads.
import type { FileAttachment, AssistantMsg, StoredMessage } from "./messages";
import type { ThinkingLevel, PermissionMode } from "./models";
import type { ApprovalRequest, QuestionRequest } from "./requests";

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type SessionStatus = "idle" | "running" | "waiting" | "error";

/** What a running session is doing before the model's reply is visible: set up, memory recall, request sent
 *  with no response yet, response started with nothing to show yet. Null once there is something to show. */
export type RunPhase = "preparing" | "recalling" | "requesting" | "responding";

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
  /** The session this one was forked from, and the last message it shares with it. */
  forkOf: string | null;
  forkSeq: number | null;
  /** Set on a session merged into another; it is archived, not deleted. */
  mergedInto: string | null;
}

export interface CompactionInfo {
  id: number;
  cutSeq: number;
  summary: string;
  tokensBefore: number;
  createdAt: number;
  auto: boolean;
}

/** Estimated tokens per part of the context window; `used` is the provider's own count when known. */
export interface ContextBreakdown {
  window: number;
  used: number;
  parts: { messages: number; system: number; tools: number; mcp: number; skills: number; instructions: number };
  /** Room auto-compaction keeps free (the part above its threshold); 0 when it is off. */
  buffer: number;
  counts: { mcpTools: number; tools: number; skills: number; instructionFiles: number };
}

export interface SessionDetail {
  session: SessionInfo;
  messages: StoredMessage[];
  compactions: CompactionInfo[];
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  streaming: AssistantMsg | null;
  phase: RunPhase | null;
  runningTools: Record<string, { toolName: string; args: any; partial: any; startedAt: number }>;
  queued: QueuedMessage[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  mode: "steer" | "followUp";
  files?: FileAttachment[];
}

/** Durable background summarization and delivery into another session. */
export interface MergeJob {
  id: string;
  sourceId: string;
  targetId: string;
  state: "queued" | "running" | "ready" | "succeeded" | "failed";
  error: string | null;
  createdAt: number;
}
