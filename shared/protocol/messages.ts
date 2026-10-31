// The conversation as stored and streamed: content blocks, the three message roles, and tool details.

export const FILE_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

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

export interface FileAttachment {
  path: string;
  name: string;
  mimeType: string;
  size: number;
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
  files?: FileAttachment[];
  display?: string;
  /** A note added by merging another session into this one; the content is the note the model reads. */
  merge?: { sessionId: string; title: string; messages: number; summary: string };
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
