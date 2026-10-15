import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "typebox";
import type { AppSettings, Todo } from "../../shared/protocol";

export type ToolCategory = "read" | "edit" | "exec" | "network" | "mcp" | "meta";

export interface KestrelTool extends AgentTool<any, any> {
  category: ToolCategory;
}

export interface SubagentRequest {
  description: string;
  prompt: string;
}

export interface ToolContext {
  sessionId: string;
  cwd: () => string;
  settings: () => AppSettings;
  readFiles: Map<string, number>;
  setTodos: (todos: Todo[]) => void;
  runSubagent: (req: SubagentRequest, signal: AbortSignal | undefined, onProgress: (details: any) => void) => Promise<string>;
}

export const text = (t: string) => [{ type: "text" as const, text: t }];

export function defineTool<T extends TSchema>(
  tool: Omit<KestrelTool, "parameters" | "execute"> & {
    parameters: T;
    execute: (
      toolCallId: string,
      params: Static<T>,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<any>,
    ) => Promise<AgentToolResult<any>>;
  },
): KestrelTool {
  return tool as unknown as KestrelTool;
}
