// The model's context: what fills the window, auto-compaction before a request, memory notes, and compaction itself.
import { type AgentMessage } from "@mariozechner/pi-agent-core";
import type { ContextBreakdown } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";
import { mcpStatuses } from "../mcp";
import { st } from "../i18n";
import { costOf, sideModel } from "../side-model";
import { discoverSkills } from "../skills";
import { memoryConfigured } from "../memory-config";
import { memoryConfigKey } from "../memory-retrieval";
import type { KestrelTool } from "../tools/types";
import { estimateContextTokens, estimateMessageTokens, estimateTextTokens, findCutIndex, summarize, summaryMessage } from "./compaction";
import { buildSystemPrompt, collectInstructions } from "./prompt";
import type { SessionRunner } from "./session-runner";
import * as setup from "./setup";
import { logger } from "../log";

/** Where the context window goes, estimated with the same token heuristic auto-compaction uses. */
export function contextBreakdown(runner: SessionRunner): ContextBreakdown {
  const s = runner.info();
  const settings = store.getSettings();
  const cfg = s.providerId && s.modelId ? store.getModel(s.providerId, s.modelId) : null;
  const window = cfg?.contextWindow ?? 128000;
  const tools = setup.buildTools(runner, s.kind === "subagent");
  const schema = (t: KestrelTool) => estimateTextTokens(JSON.stringify([t.name, t.description, t.parameters]));
  const mcp = tools.filter((t) => t.category === "mcp");
  const builtIn = tools.filter((t) => t.category !== "mcp");
  const prompt = buildSystemPrompt({
    cwd: s.cwd,
    permissionMode: s.permissionMode,
    modelName: cfg?.name ?? s.modelId,
    subagent: s.kind === "subagent",
    mcpServers: mcpStatuses().filter((m) => m.state === "connected").map((m) => m.name),
  });
  const instructions = collectInstructions(s.cwd).reduce((n, f) => n + estimateTextTokens(f.content), estimateTextTokens(settings.systemPromptAppend));
  const skills = discoverSkills(s.cwd).reduce((n, k) => n + estimateTextTokens(`- ${k.name}: ${k.description.replace(/\s+/g, " ").slice(0, 280)}\n`), 0);
  const messages = runner.agent.state.messages.slice(runner.compaction?.cutSeq ?? 0);
  const history = messages.reduce((n, m) => n + estimateMessageTokens(m), runner.compaction ? estimateTextTokens(runner.compaction.summary) : 0);
  // The prompt holds the instructions and skill list; count those once, under their own names.
  const system = Math.max(0, estimateTextTokens(prompt) - instructions - skills);
  const parts = { messages: history, system, tools: builtIn.reduce((n, t) => n + schema(t), 0), mcp: mcp.reduce((n, t) => n + schema(t), 0), skills, instructions };
  const used = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    window,
    // The last reply's reported usage is exact; the parts are estimates scaled to it when there is one.
    used: s.usage.contextTokens || used,
    parts,
    buffer: settings.autoCompact ? Math.round(window * (1 - settings.compactThreshold)) : 0,
    counts: { mcpTools: mcp.length, tools: builtIn.length, skills: discoverSkills(s.cwd).length, instructionFiles: collectInstructions(s.cwd).length },
  };
}

export async function transformContext(runner: SessionRunner, messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
  try {
    const settings = store.getSettings();
    const model = runner.agent.state.model;
    if (settings.autoCompact && !runner.compacting) {
      const start = runner.compaction?.cutSeq ?? 0;
      const est = runner.compaction
        ? estimateContextTokens(messages.slice(start), runner.compaction.summary, runner.compaction.at, estimateTextTokens(runner.agent.state.systemPrompt))
        : estimateContextTokens(messages, null, 0, estimateTextTokens(runner.agent.state.systemPrompt));
      if (est > model.contextWindow * settings.compactThreshold) {
        await compact(runner, { auto: true, messages, signal }).catch((e) => {
          logger("agent").warn("auto compaction failed", { sessionId: runner.id, error: e });
          emit({ type: "notice", sessionId: runner.rootId, level: "warn", text: st("autoCompactFailed", { msg: e?.message ?? String(e) }) });
        });
      }
    }
  } catch {}
  const start = Math.min(runner.compaction?.cutSeq ?? 0, messages.length);
  const rest = messages.slice(start);
  const context = runner.compaction ? [summaryMessage(runner.compaction.summary), ...rest] : rest;
  const settings = store.getSettings();
  if (settings.memoryEnabled && memoryConfigured(settings)) runner.setPhase("recalling");
  const result = await runner.memoryContext.inject(settings, context, messages, signal, (text) => emit({ type: "notice", sessionId: runner.rootId, level: "warn", text }));
  if (memoryConfigKey(settings) !== memoryConfigKey(store.getSettings())) throw new Error("Memory configuration changed during retrieval. Retry the request.");
  // The request goes out right after this returns; the reply's first event moves the phase on.
  runner.setPhase("requesting");
  return result;
}

export async function compact(runner: SessionRunner, opts: { auto: boolean; messages?: AgentMessage[]; signal?: AbortSignal; instructions?: string; full?: boolean }) {
  if (runner.compacting) return;
  const messages = opts.messages ?? runner.agent.state.messages;
  const start = runner.compaction?.cutSeq ?? 0;
  const settings = store.getSettings();
  const cut = opts.full ? messages.length : findCutIndex(messages, start, settings.keepRecentTokens);
  if (cut <= start) {
    if (!opts.auto) throw new Error(st("nothingToCompact"));
    return;
  }
  const s = runner.info();
  // Summaries can run on a cheaper model chosen in Settings; its window decides how much history it is given.
  const side = sideModel(settings.compactModel, s);
  runner.compacting = true;
  const startedAt = Date.now();
  logger("agent").info("compaction started", { sessionId: runner.id, auto: opts.auto, model: side.modelId, messages: cut - start });
  emit({ type: "compacting", sessionId: runner.id, active: true });
  try {
    const tokensBefore = estimateContextTokens(messages.slice(start), runner.compaction?.summary ?? null);
    const { summary, usage } = await summarize({
      providerId: side.providerId,
      modelId: side.modelId,
      contextWindow: side.config.contextWindow,
      previousSummary: runner.compaction?.summary ?? null,
      messages: messages.slice(start, cut),
      instructions: opts.instructions,
      signal: opts.signal,
    });
    if (!summary) throw new Error(st("emptySummary"));
    const info = store.addCompaction(runner.id, cut, summary, tokensBefore, opts.auto);
    runner.compaction = { cutSeq: cut, summary, at: info.createdAt };
    const cost = costOf(usage, side.config);
    store.recordUsage({ sessionId: runner.id, providerId: side.providerId, modelId: side.modelId, ...usage, cost, purpose: "compaction" });
    const overhead = estimateTextTokens(runner.agent.state.systemPrompt) + estimateTextTokens(JSON.stringify(runner.agent.state.tools.map((t) => [t.name, t.description, t.parameters])));
    const after = overhead + estimateTextTokens(summary) + messages.slice(cut).reduce((n, m) => n + estimateMessageTokens(m), 0);
    store.addSessionUsage(runner.id, { ...usage, cost }, after);
    emit({ type: "compaction", sessionId: runner.id, compaction: info });
    runner.emitSession();
  } finally {
    runner.compacting = false;
    emit({ type: "compacting", sessionId: runner.id, active: false });
    logger("agent").info("compaction finished", { sessionId: runner.id, auto: opts.auto, ms: Date.now() - startedAt });
  }
}
