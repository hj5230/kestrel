// What a run starts from: the tools the session gets and the model, thinking level and system prompt it runs with.
import fs from "node:fs";
import type { Todo } from "../../shared/protocol";
import * as store from "../db";
import { mcpStatuses, mcpTools } from "../mcp";
import { st } from "../i18n";
import { resolveThinking } from "../../shared/effort";
import { resolveModel, toPiModel } from "../providers";
import { discoverSkills } from "../skills";
import { createBashOutputTool, createBashTool, createKillShellTool } from "../tools/bash";
import { createAskUserTool } from "../tools/ask";
import { withEmptyArgsHint } from "../tools/empty-args";
import { createEditTool, createGlobTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from "../tools/fs-tools";
import { memoryTools } from "../tools/memory";
import { memoryConfigured } from "../memory-config";
import { createReadSessionTool, createSearchSessionsTool, createSkillTool, createTaskTool, createTodoTool } from "../tools/meta";
import type { KestrelTool, ToolContext } from "../tools/types";
import { createWebFetchTool, createWebSearchTool } from "../tools/web";
import { buildSystemPrompt } from "./prompt";
import type { SessionRunner } from "./session-runner";
import * as gate from "./gate";
import * as subagents from "./subagents";

export function buildTools(runner: SessionRunner, subagent: boolean): KestrelTool[] {
  const ctx: ToolContext = {
    sessionId: runner.id,
    cwd: () => runner.info().cwd,
    settings: () => store.getSettings(),
    readFiles: runner.readFiles,
    readMemories: runner.memoryContext.read,
    setTodos: (todos: Todo[]) => {
      store.updateSession(runner.id, { todos });
      runner.emitSession();
    },
    runSubagent: (req, signal, onProgress) => subagents.runSubagent(runner, req, signal, onProgress),
    ask: (req, signal) => gate.ask(runner, req, signal),
  };
  const tools: KestrelTool[] = [
    createReadTool(ctx),
    createWriteTool(ctx),
    createEditTool(ctx),
    createLsTool(ctx),
    createGlobTool(ctx),
    createGrepTool(ctx),
    createBashTool(ctx),
    createBashOutputTool(ctx),
    createKillShellTool(ctx),
    createWebFetchTool(),
    createSearchSessionsTool(ctx),
    createReadSessionTool(),
  ];
  // Subagents can't talk to the user; they report back to the agent that launched them.
  if (!subagent) tools.push(createTodoTool(ctx), createTaskTool(ctx), createAskUserTool(ctx));
  if (store.getSettings().tavilyApiKey.trim()) tools.push(createWebSearchTool(ctx));
  if (discoverSkills(runner.info().cwd).length) tools.push(createSkillTool(ctx));
  if (store.getSettings().memoryEnabled && memoryConfigured(store.getSettings())) tools.push(...memoryTools(ctx, { readOnly: subagent }));
  tools.push(...mcpTools());
  return tools.map(withEmptyArgsHint);
}

export function prepare(runner: SessionRunner) {
  const s = runner.info();
  if (!s.providerId || !s.modelId) throw new Error(st("noModel"));
  if (!fs.existsSync(s.cwd)) throw new Error(st("cwdMissing", { path: s.cwd }));
  const cfg = resolveModel(s.providerId, s.modelId);
  const model = toPiModel(cfg);
  runner.agent.state.model = model;
  runner.agent.state.thinkingLevel = (cfg.reasoning ? (resolveThinking(s.thinking, cfg.efforts, cfg.effortDefault) ?? "off") : "off") as any;
  runner.agent.state.tools = buildTools(runner, s.kind === "subagent");
  runner.agent.state.systemPrompt = buildSystemPrompt({
    cwd: s.cwd,
    permissionMode: s.permissionMode,
    modelName: cfg.name,
    subagent: s.kind === "subagent",
    mcpServers: mcpStatuses()
      .filter((m) => m.state === "connected")
      .map((m) => m.name),
  });
}
