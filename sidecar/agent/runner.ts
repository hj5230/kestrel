import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { isContextOverflow, type ImageContent, type Message } from "@mariozechner/pi-ai";
import { generateText } from "ai";
import fs from "node:fs";
import path from "node:path";
import type {
  ApprovalDecision,
  ApprovalRequest,
  AssistantMsg,
  ChatMessage,
  Question,
  QuestionAnswer,
  QuestionRequest,
  QueuedMessage,
  SessionDetail,
  SessionInfo,
  SubagentDetails,
  Todo,
} from "../../shared/protocol";
import * as store from "../db";
import { shellEnvReady } from "../env";
import { emit } from "../hub";
import { createVercelStreamFn } from "../llm/vercel-stream";
import { mcpStatuses, mcpTools } from "../mcp";
import { st } from "../i18n";
import { buildTranscript, describeAction, partsFromMessages, reviewAction, reviewerConfigured } from "../auto-review";
import { evaluatePermission, isBroadEntry, type PermissionResult } from "../permissions";
import { languageModel, resolveModel, toPiModel } from "../providers";
import { costOf, parseModelSetting, recordSideUsage, sideModel, usageOf } from "../side-model";
import { createSession, newId } from "../sessions";
import { discoverSkills, expandSlashCommand } from "../skills";
import { createBashOutputTool, createBashTool, createKillShellTool, killSessionShells } from "../tools/bash";
import { createAskUserTool, sanitizeAnswers } from "../tools/ask";
import { withEmptyArgsHint } from "../tools/empty-args";
import { createEditTool, createGlobTool, createGrepTool, createLsTool, createReadTool, createWriteTool } from "../tools/fs-tools";
import { memoryTools } from "../tools/memory";
import { createReadSessionTool, createSearchSessionsTool, createSkillTool, createTaskTool, createTodoTool } from "../tools/meta";
import type { KestrelTool, SubagentRequest, ToolContext } from "../tools/types";
import { createWebFetchTool, createWebSearchTool } from "../tools/web";
import { estimateContextTokens, estimateMessageTokens, estimateTextTokens, findCutIndex, summarize, summaryMessage } from "./compaction";
import { buildSystemPrompt } from "./prompt";

const runners = new Map<string, SessionRunner>();

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (d: { decision: ApprovalDecision; reason?: string; pattern?: string }) => void;
  owner: SessionRunner;
}
const approvals = new Map<string, PendingApproval>();

interface PendingQuestion {
  request: QuestionRequest;
  resolve: (answers: QuestionAnswer[] | null) => void;
  owner: SessionRunner;
}
const pendingQuestions = new Map<string, PendingQuestion>();

export function getRunner(id: string): SessionRunner {
  let r = runners.get(id);
  if (!r) {
    const info = store.getSession(id);
    if (!info) throw new Error(st("sessionNotFound"));
    r = new SessionRunner(info, null);
    runners.set(id, r);
  }
  return r;
}

export function peekRunner(id: string): SessionRunner | undefined {
  return runners.get(id);
}

export function dropRunner(id: string) {
  const r = runners.get(id);
  if (r) {
    r.abort();
    runners.delete(id);
  }
}

export function respondApproval(id: string, decision: ApprovalDecision, reason?: string, pattern?: string) {
  const p = approvals.get(id);
  if (!p) throw new Error(st("approvalExpired"));
  p.resolve({ decision, reason, pattern });
}

/** `null` dismisses the question. */
export function respondQuestion(id: string, answers: QuestionAnswer[] | null) {
  const p = pendingQuestions.get(id);
  if (!p) throw new Error(st("questionExpired"));
  p.resolve(answers);
}

export function sessionDetail(id: string): SessionDetail {
  const info = store.getSession(id);
  if (!info) throw new Error(st("sessionNotFound"));
  const r = runners.get(id);
  return {
    session: info,
    messages: store.loadMessages(id),
    compactions: store.listCompactions(id),
    approvals: [...approvals.values()].filter((a) => a.request.sessionId === id).map((a) => a.request),
    questions: [...pendingQuestions.values()].filter((q) => q.request.sessionId === id).map((q) => q.request),
    streaming: r?.streaming ?? null,
    runningTools: r?.runningTools ?? {},
    queued: r?.queued.map(({ id, text, mode }) => ({ id, text, mode })) ?? [],
  };
}

function textOf(m: AgentMessage | undefined): string {
  if (!m || (m as any).role !== "assistant") return "";
  return (m as any).content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
    .trim();
}

function brief(toolName: string, args: any): string {
  if (!args) return toolName;
  const v = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? args.description ?? args.name;
  return v ? `${toolName} ${String(v).slice(0, 80)}` : toolName;
}

function usageCost(u: any) {
  return {
    input: u?.input ?? 0,
    output: u?.output ?? 0,
    cacheRead: u?.cacheRead ?? 0,
    cacheWrite: u?.cacheWrite ?? 0,
    cost: u?.cost?.total ?? 0,
  };
}

export class SessionRunner {
  readonly id: string;
  readonly agent: Agent;
  readonly parent: SessionRunner | null;
  readonly rootId: string;
  readFiles = new Map<string, number>();
  queued: (QueuedMessage & { ts: number; msg: AgentMessage })[] = [];
  streaming: AssistantMsg | null = null;
  runningTools: SessionDetail["runningTools"] = {};
  compacting = false;
  private compaction: { cutSeq: number; summary: string; at: number } | null = null;
  private toolStarted = new Map<string, number>();
  private lastStreamEmit = 0;
  private streamTimer: ReturnType<typeof setTimeout> | null = null;
  private toolEmitAt = new Map<string, number>();
  private runPromise: Promise<void> | null = null;
  private overflowRetried = false;

  constructor(info: SessionInfo, parent: SessionRunner | null) {
    this.id = info.id;
    this.parent = parent;
    this.rootId = parent ? parent.rootId : info.id;
    this.loadCompaction();
    const messages = store.loadMessages(info.id).map((s) => s.message as AgentMessage);
    const placeholder = toPiModel({
      providerId: info.providerId,
      id: info.modelId || "unset",
      name: info.modelId,
      contextWindow: 128000,
      maxTokens: 16384,
      reasoning: false,
      vision: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      enabled: true,
    });
    this.agent = new Agent({
      initialState: { systemPrompt: "", model: placeholder, thinkingLevel: info.thinking as any, tools: [], messages },
      streamFn: createVercelStreamFn((m) => ({ model: languageModel(m.provider, m.id) })),
      convertToLlm: (msgs) =>
        msgs.filter((m: any) => m.role === "user" || m.role === "toolResult" || (m.role === "assistant" && m.content?.length)) as Message[],
      transformContext: (msgs, signal) => this.transformContext(msgs, signal),
      beforeToolCall: (ctx, signal) => this.beforeToolCall(ctx, signal),
      afterToolCall: async (ctx) => {
        const d = ctx.result?.details as any;
        if (ctx.toolCall.name === "bash" && d && !d.background && d.exitCode !== 0 && d.exitCode !== undefined) return { isError: true };
        return undefined;
      },
      steeringMode: "all",
      followUpMode: "all",
      toolExecution: "parallel",
      sessionId: info.id,
    });
    this.agent.subscribe((e) => this.onEvent(e));
  }

  info(): SessionInfo {
    const s = store.getSession(this.id);
    if (!s) throw new Error(st("sessionNotFound"));
    return s;
  }

  get busy() {
    return this.agent.state.isStreaming || this.compacting;
  }

  private emitSession() {
    const s = store.getSession(this.id);
    if (s) emit({ type: "session_updated", session: s });
  }

  private emitQueue() {
    emit({ type: "queue", sessionId: this.id, queued: this.queued.map(({ id, text, mode }) => ({ id, text, mode })) });
  }

  private loadCompaction() {
    const list = store.listCompactions(this.id);
    const last = list[list.length - 1];
    this.compaction = last ? { cutSeq: last.cutSeq, summary: last.summary, at: last.createdAt } : null;
  }

  private buildTools(subagent: boolean): KestrelTool[] {
    const ctx: ToolContext = {
      sessionId: this.id,
      cwd: () => this.info().cwd,
      settings: () => store.getSettings(),
      readFiles: this.readFiles,
      setTodos: (todos: Todo[]) => {
        store.updateSession(this.id, { todos });
        this.emitSession();
      },
      runSubagent: (req, signal, onProgress) => this.runSubagent(req, signal, onProgress),
      ask: (req, signal) => this.ask(req, signal),
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
    if (discoverSkills(this.info().cwd).length) tools.push(createSkillTool(ctx));
    if (store.getSettings().memoryEnabled) tools.push(...memoryTools(ctx, { readOnly: subagent }));
    tools.push(...mcpTools());
    return tools.map(withEmptyArgsHint);
  }

  private prepare() {
    const s = this.info();
    if (!s.providerId || !s.modelId) throw new Error(st("noModel"));
    if (!fs.existsSync(s.cwd)) throw new Error(st("cwdMissing", { path: s.cwd }));
    const cfg = resolveModel(s.providerId, s.modelId);
    const model = toPiModel(cfg);
    this.agent.state.model = model;
    this.agent.state.thinkingLevel = (cfg.reasoning ? s.thinking : "off") as any;
    this.agent.state.tools = this.buildTools(s.kind === "subagent");
    this.agent.state.systemPrompt = buildSystemPrompt({
      cwd: s.cwd,
      permissionMode: s.permissionMode,
      modelName: cfg.name,
      subagent: s.kind === "subagent",
      mcpServers: mcpStatuses()
        .filter((m) => m.state === "connected")
        .map((m) => m.name),
    });
  }

  // ---------- context ----------

  private async transformContext(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
    try {
      const settings = store.getSettings();
      const model = this.agent.state.model;
      if (settings.autoCompact && !this.compacting) {
        const start = this.compaction?.cutSeq ?? 0;
        const est = this.compaction
          ? estimateContextTokens(messages.slice(start), this.compaction.summary, this.compaction.at, estimateTextTokens(this.agent.state.systemPrompt))
          : estimateContextTokens(messages, null, 0, estimateTextTokens(this.agent.state.systemPrompt));
        if (est > model.contextWindow * settings.compactThreshold) {
          await this.compact({ auto: true, messages, signal }).catch((e) => {
            emit({ type: "notice", sessionId: this.rootId, level: "warn", text: st("autoCompactFailed", { msg: e?.message ?? String(e) }) });
          });
        }
      }
    } catch {}
    const start = Math.min(this.compaction?.cutSeq ?? 0, messages.length);
    const rest = messages.slice(start);
    return this.compaction ? [summaryMessage(this.compaction.summary), ...rest] : rest;
  }

  async compact(opts: { auto: boolean; messages?: AgentMessage[]; signal?: AbortSignal; instructions?: string; full?: boolean }) {
    if (this.compacting) return;
    const messages = opts.messages ?? this.agent.state.messages;
    const start = this.compaction?.cutSeq ?? 0;
    const settings = store.getSettings();
    const cut = opts.full ? messages.length : findCutIndex(messages, start, settings.keepRecentTokens);
    if (cut <= start) {
      if (!opts.auto) throw new Error(st("nothingToCompact"));
      return;
    }
    const s = this.info();
    // Summaries can run on a cheaper model chosen in Settings; its window decides how much history it is given.
    const side = sideModel(settings.compactModel, s);
    this.compacting = true;
    emit({ type: "compacting", sessionId: this.id, active: true });
    try {
      const tokensBefore = estimateContextTokens(messages.slice(start), this.compaction?.summary ?? null);
      const { summary, usage } = await summarize({
        providerId: side.providerId,
        modelId: side.modelId,
        contextWindow: side.config.contextWindow,
        previousSummary: this.compaction?.summary ?? null,
        messages: messages.slice(start, cut),
        instructions: opts.instructions,
        signal: opts.signal,
      });
      if (!summary) throw new Error(st("emptySummary"));
      const info = store.addCompaction(this.id, cut, summary, tokensBefore, opts.auto);
      this.compaction = { cutSeq: cut, summary, at: info.createdAt };
      const cost = costOf(usage, side.config);
      store.recordUsage({ sessionId: this.id, providerId: side.providerId, modelId: side.modelId, ...usage, cost, purpose: "compaction" });
      const overhead = estimateTextTokens(this.agent.state.systemPrompt) + estimateTextTokens(JSON.stringify(this.agent.state.tools.map((t) => [t.name, t.description, t.parameters])));
      const after = overhead + estimateTextTokens(summary) + messages.slice(cut).reduce((n, m) => n + estimateMessageTokens(m), 0);
      store.addSessionUsage(this.id, { ...usage, cost }, after);
      emit({ type: "compaction", sessionId: this.id, compaction: info });
      this.emitSession();
    } finally {
      this.compacting = false;
      emit({ type: "compacting", sessionId: this.id, active: false });
    }
  }

  // ---------- permissions ----------

  /** Auto-review bookkeeping, shared by the session and its subagents. */
  private gate = { consecutive: 0, total: 0, paused: false };

  private root(): SessionRunner {
    return this.parent ? this.parent.root() : this;
  }

  /** What the reviewer reads: the user's words and the agent's tool calls, nothing else. */
  private reviewTranscript(): string {
    const own = this.agent.state.messages;
    if (!this.parent) return buildTranscript(partsFromMessages(own));
    const rootParts = partsFromMessages(this.root().agent.state.messages).filter((p) => p.role !== "tool_call");
    return buildTranscript([...rootParts, ...partsFromMessages(own, { firstUserIsTask: true })]);
  }

  /** Auto mode: the reviewer decides. Returns a block result, or null to let the call run; falls back to asking a person. */
  private async autoReview(tool: KestrelTool, args: unknown, perm: PermissionResult, signal?: AbortSignal): Promise<{ block: true; reason: string } | PermissionResult | null> {
    const gate = this.root().gate;
    if (gate.paused) return { ...perm, action: "ask", note: { code: "review_paused" } };
    try {
      const settings = store.getSettings();
      const picked = parseModelSetting(settings.autoModel);
      const r = await reviewAction({
        settings,
        transcript: this.reviewTranscript(),
        action: describeAction(tool, args, this.info().cwd),
        signal,
        onUsage: (u) => picked && recordSideUsage(this.id, "review", picked, u),
      });
      if (!r.block) {
        gate.consecutive = 0;
        return null;
      }
      gate.consecutive++;
      gate.total++;
      if (gate.consecutive < 3 && gate.total < 20) {
        return {
          block: true,
          reason:
            `Auto review blocked this action: ${r.reason} ` +
            "Treat this as a boundary, not an obstacle: do not retry it, reword it, split it into smaller steps or run it another way. " +
            "Pick a clearly safer approach that still serves the user's request, or ask the user how to proceed.",
        };
      }
      // Too many blocks: stop and hand this one to a person. Approving it resumes auto mode.
      gate.paused = true;
      gate.consecutive = 0;
      if (gate.total >= 20) gate.total = 0;
      return { ...perm, action: "ask", note: { code: "review_blocked", detail: r.reason } };
    } catch (e: any) {
      if (signal?.aborted) return { block: true, reason: "Operation aborted by the user." };
      return { ...perm, action: "ask", note: { code: "review_error", detail: String(e?.message ?? e).slice(0, 200) } };
    }
  }

  /** The session shows "waiting" while anything (an approval or a question) needs the user. */
  private syncWaiting() {
    const id = this.rootId;
    const waiting = [...approvals.values()].some((a) => a.request.sessionId === id) || [...pendingQuestions.values()].some((q) => q.request.sessionId === id);
    const root = store.getSession(id);
    if (!root || (waiting ? root.status === "waiting" : root.status !== "waiting")) return;
    store.updateSession(id, { status: waiting ? "waiting" : "running" });
    const next = store.getSession(id);
    if (next) emit({ type: "session_updated", session: next });
  }

  /** The `ask_user` tool: show the questions, wait for the answers. Null when dismissed or aborted. */
  private async ask(req: { toolCallId: string; title?: string; questions: Question[] }, signal?: AbortSignal): Promise<QuestionAnswer[] | null> {
    const request: QuestionRequest = { id: newId("qn_"), sessionId: this.rootId, createdAt: Date.now(), ...req };
    const answers = await new Promise<QuestionAnswer[] | null>((resolve) => {
      if (signal?.aborted) return resolve(null);
      const onAbort = () => resolve(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      pendingQuestions.set(request.id, {
        request,
        owner: this,
        resolve: (a) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(a);
        },
      });
      this.syncWaiting();
      emit({ type: "question_request", request });
    });
    pendingQuestions.delete(request.id);
    emit({ type: "question_resolved", sessionId: this.rootId, id: request.id });
    this.syncWaiting();
    return answers && sanitizeAnswers(req.questions, answers);
  }

  private async beforeToolCall(ctx: { toolCall: any; args: unknown }, signal?: AbortSignal) {
    const tool = (this.agent.state.tools as KestrelTool[]).find((t) => t.name === ctx.toolCall.name);
    if (!tool) return undefined;
    const s = this.info();
    const settings = store.getSettings();
    let perm = evaluatePermission(tool, ctx.args, s.permissionMode, settings, {
      cwd: s.cwd,
      dataDir: path.dirname(store.dbPath),
      reviewer: reviewerConfigured(settings),
    });
    if (perm.action === "review") {
      const out = await this.autoReview(tool, ctx.args, perm, signal);
      if (out === null) return undefined;
      if ("block" in out) return out;
      perm = out;
    }
    if (perm.action === "allow") return undefined;
    if (perm.action === "deny") return { block: true, reason: perm.reason };

    const request: ApprovalRequest = {
      id: newId("ap_"),
      sessionId: this.rootId,
      toolCallId: ctx.toolCall.id,
      toolName: tool.name,
      args: ctx.args,
      kind: perm.kind,
      path: perm.path,
      detail: perm.detail,
      subagent: !!this.parent,
      whitelistSuggestion: perm.suggestion,
      note: perm.note ?? null,
      createdAt: Date.now(),
    };
    const decision = await new Promise<{ decision: ApprovalDecision; reason?: string; pattern?: string }>((resolve) => {
      const onAbort = () => resolve({ decision: "deny", reason: "aborted" });
      signal?.addEventListener("abort", onAbort, { once: true });
      approvals.set(request.id, {
        request,
        owner: this,
        resolve: (d) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(d);
        },
      });
      this.syncWaiting();
      emit({ type: "approval_request", request });
    });
    approvals.delete(request.id);
    emit({ type: "approval_resolved", sessionId: this.rootId, id: request.id });
    this.syncWaiting();

    if (decision.decision === "deny") {
      if (decision.reason === "aborted") return { block: true, reason: "Operation aborted by the user." };
      return {
        block: true,
        reason: `The user denied this tool call.${decision.reason ? ` User's note: ${decision.reason}` : ""} Do not retry the same call; adjust your approach or ask the user how to proceed.`,
      };
    }
    // A person approved something: auto mode picks up again.
    this.root().gate = { ...this.root().gate, paused: false, consecutive: 0 };
    const pattern = (decision.pattern ?? perm.suggestion ?? "").trim();
    // A rule that lets any command through (`bash`, `rm`, `python3`, …) is never saved.
    if (decision.decision === "allow_always" && pattern && !(perm.kind === "bash" && isBroadEntry(pattern))) {
      const settings = store.getSettings();
      const key = perm.kind === "bash" ? "bashWhitelist" : "toolWhitelist";
      if (!settings[key].includes(pattern)) store.saveSettings({ [key]: [...settings[key], pattern] });
    }
    return undefined;
  }

  // ---------- events ----------

  private flushStream() {
    this.streamTimer = null;
    this.lastStreamEmit = Date.now();
    emit({ type: "stream", sessionId: this.id, message: this.streaming });
  }

  private onEvent(e: any) {
    switch (e.type) {
      case "message_start":
        if (e.message.role === "assistant") {
          this.streaming = e.message;
          this.flushStream();
        }
        break;
      case "message_update":
        if (e.message.role === "assistant") {
          this.streaming = e.message;
          const wait = 40 - (Date.now() - this.lastStreamEmit);
          if (wait <= 0) this.flushStream();
          else if (!this.streamTimer) this.streamTimer = setTimeout(() => this.flushStream(), wait);
        }
        break;
      case "message_end": {
        const msg = e.message as ChatMessage;
        if (msg.role === "assistant") {
          if (this.streamTimer) clearTimeout(this.streamTimer);
          this.streamTimer = null;
          this.streaming = null;
        }
        const stored = store.appendMessage(this.id, msg);
        emit({ type: "message_appended", sessionId: this.id, stored });
        if (msg.role === "assistant") {
          emit({ type: "stream", sessionId: this.id, message: null });
          const u = usageCost(msg.usage);
          const ctxTokens = (msg.usage?.input ?? 0) + (msg.usage?.cacheRead ?? 0) + (msg.usage?.cacheWrite ?? 0) + (msg.usage?.output ?? 0);
          const s = this.info();
          if (u.input || u.output || u.cacheRead || u.cacheWrite) {
            store.recordUsage({ sessionId: this.id, providerId: s.providerId, modelId: msg.model, ...u, purpose: s.kind === "subagent" ? "subagent" : "chat" });
            store.addSessionUsage(this.id, u, ctxTokens > 0 ? ctxTokens : null);
            if (this.parent) {
              store.addSessionUsage(this.parent.id, u, null);
              this.parent.emitSession();
            }
          }
          this.emitSession();
          this.maybeTitle(s);
        } else if (msg.role === "user") {
          const qi = this.queued.findIndex((q) => q.ts === msg.timestamp);
          if (qi >= 0) {
            this.queued.splice(qi, 1);
            this.emitQueue();
          }
        }
        break;
      }
      case "tool_execution_start":
        this.toolStarted.set(e.toolCallId, Date.now());
        this.runningTools[e.toolCallId] = { toolName: e.toolName, args: e.args, partial: null, startedAt: Date.now() };
        emit({ type: "tool_start", sessionId: this.id, toolCallId: e.toolCallId, toolName: e.toolName, args: e.args });
        break;
      case "tool_execution_update": {
        const rt = this.runningTools[e.toolCallId];
        if (rt) rt.partial = e.partialResult?.details ?? e.partialResult;
        const last = this.toolEmitAt.get(e.toolCallId) ?? 0;
        if (Date.now() - last > 100) {
          this.toolEmitAt.set(e.toolCallId, Date.now());
          emit({ type: "tool_update", sessionId: this.id, toolCallId: e.toolCallId, partial: rt?.partial });
        }
        break;
      }
      case "tool_execution_end": {
        const started = this.toolStarted.get(e.toolCallId) ?? Date.now();
        this.toolStarted.delete(e.toolCallId);
        this.toolEmitAt.delete(e.toolCallId);
        delete this.runningTools[e.toolCallId];
        store.recordToolEvent(this.id, e.toolName, !!e.isError, Date.now() - started);
        emit({ type: "tool_end", sessionId: this.id, toolCallId: e.toolCallId });
        break;
      }
    }
  }

  private titlePending = false;
  private maybeTitle(s: SessionInfo) {
    if (s.kind !== "main" || s.title || this.titlePending) return;
    const firstUser = this.agent.state.messages.find((m: any) => m.role === "user") as any;
    if (!firstUser) return;
    const text: string =
      firstUser.display ??
      (typeof firstUser.content === "string" ? firstUser.content : firstUser.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"));
    const fallback = text.replace(/\s+/g, " ").trim().slice(0, 40) || st("untitled");
    this.titlePending = true;
    let side: ReturnType<typeof sideModel>;
    try {
      side = sideModel(store.getSettings().titleModel, s);
    } catch {
      this.titlePending = false;
      return;
    }
    generateText({
      model: languageModel(side.providerId, side.modelId),
      system:
        "Generate a concise title for the conversation that starts with the user's message below. Use the user's language. At most 16 Chinese characters or 7 English words. No quotes, no punctuation at the end. Output only the title.",
      prompt: text.slice(0, 3000),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30000),
    })
      .then((r) => {
        recordSideUsage(this.id, "title", side, usageOf(r.usage));
        return r.text.replace(/^["'「『#\s]+|["'」』。.\s]+$/g, "").split("\n")[0].slice(0, 60) || fallback;
      })
      .catch(() => fallback)
      .then((title) => {
        const cur = store.getSession(this.id);
        if (cur && !cur.title) {
          store.updateSession(this.id, { title });
          this.emitSession();
        }
      });
  }

  // ---------- running ----------

  private async run(fn: () => Promise<void>): Promise<void> {
    await shellEnvReady();
    try {
      this.prepare();
    } catch (e: any) {
      store.updateSession(this.id, { status: "error", lastError: e.message });
      this.emitSession();
      emit({ type: "notice", sessionId: this.rootId, level: "error", text: e.message });
      throw e;
    }
    store.updateSession(this.id, { status: "running", lastError: null }, true);
    this.emitSession();
    let ok = true;
    try {
      await fn();
      const last = this.agent.state.messages[this.agent.state.messages.length - 1] as any;
      if (
        last?.role === "assistant" &&
        last.stopReason === "error" &&
        !this.overflowRetried &&
        isContextOverflow(last, this.agent.state.model.contextWindow)
      ) {
        this.overflowRetried = true;
        this.dropTrailingFailure();
        emit({ type: "notice", sessionId: this.rootId, level: "info", text: st("overflowRetry") });
        await this.compact({ auto: true, full: false });
        await this.agent.continue();
      }
      const final = this.agent.state.messages[this.agent.state.messages.length - 1] as any;
      if (final?.role === "assistant" && final.stopReason === "error") {
        ok = false;
        store.updateSession(this.id, { status: "error", lastError: final.errorMessage ?? "Unknown error" });
      } else {
        store.updateSession(this.id, { status: "idle", lastError: null });
      }
    } catch (e: any) {
      ok = false;
      store.updateSession(this.id, { status: "error", lastError: e?.message ?? String(e) });
    } finally {
      this.overflowRetried = false;
      this.streaming = null;
      this.runningTools = {};
      if (this.queued.length && !this.agent.hasQueuedMessages()) {
        this.queued = [];
        this.emitQueue();
      }
      this.emitSession();
      const s = store.getSession(this.id);
      if (s?.kind === "main") emit({ type: "run_finished", sessionId: this.id, title: s.title || st("sessionFallback"), ok });
    }
  }

  private start(fn: () => Promise<void>): Promise<void> {
    const p = this.run(fn).finally(() => {
      if (this.runPromise === p) this.runPromise = null;
    });
    this.runPromise = p;
    return p;
  }

  async send(text: string, images: ImageContent[] = [], mode: "auto" | "steer" | "followUp" = "auto"): Promise<void> {
    const cwd = this.info().cwd;
    const expanded = text.startsWith("/") ? expandSlashCommand(cwd, text) : null;
    const body = expanded ?? text;
    const msg: any = {
      role: "user",
      content: images.length ? [{ type: "text", text: body }, ...images] : body,
      timestamp: Date.now(),
    };
    if (expanded) msg.display = text;
    if (this.busy) {
      const qmode = mode === "followUp" ? "followUp" : "steer";
      if (qmode === "followUp" || this.compacting) this.agent.followUp(msg);
      else this.agent.steer(msg);
      this.queued.push({ id: newId("q_"), text, mode: qmode, ts: msg.timestamp, msg });
      this.emitQueue();
      return;
    }
    this.start(() => this.agent.prompt(msg)).catch(() => {});
  }

  async sendAndWait(text: string): Promise<void> {
    await this.start(() => this.agent.prompt(text)).catch(() => {});
  }

  cancelQueued(id: string) {
    const q = this.queued.find((x) => x.id === id);
    if (!q) return;
    this.queued = this.queued.filter((x) => x.id !== id);
    this.agent.clearAllQueues();
    for (const k of this.queued) {
      if (k.mode === "followUp") this.agent.followUp(k.msg);
      else this.agent.steer(k.msg);
    }
    this.emitQueue();
  }

  abort() {
    for (const a of approvals.values()) if (a.owner === this) a.resolve({ decision: "deny", reason: "aborted" });
    for (const q of pendingQuestions.values()) if (q.owner === this) q.resolve(null);
    this.agent.clearAllQueues();
    this.queued = [];
    this.emitQueue();
    this.agent.abort();
    killSessionShells(this.id);
  }

  private dropTrailingFailure() {
    const msgs = this.agent.state.messages;
    const last = msgs[msgs.length - 1] as any;
    if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted")) {
      store.truncateMessages(this.id, msgs.length - 1);
      this.agent.state.messages = msgs.slice(0, -1);
      emit({ type: "messages_reset", sessionId: this.id });
      return true;
    }
    return false;
  }

  async retry() {
    if (this.busy) throw new Error(st("sessionBusy"));
    this.dropTrailingFailure();
    const msgs = this.agent.state.messages;
    const last = msgs[msgs.length - 1] as any;
    if (!last) throw new Error(st("nothingToRetry"));
    if (last.role === "assistant") {
      const prevUser = [...msgs].reverse().findIndex((m: any) => m.role === "user");
      if (prevUser < 0) throw new Error(st("nothingToRetry"));
      const idx = msgs.length - 1 - prevUser;
      store.truncateMessages(this.id, idx + 1);
      this.agent.state.messages = msgs.slice(0, idx + 1);
      this.loadCompaction();
      emit({ type: "messages_reset", sessionId: this.id });
    }
    this.start(() => this.agent.continue()).catch(() => {});
  }

  async editAndResend(seq: number, text: string, images: ImageContent[] = []) {
    if (this.busy) throw new Error(st("sessionBusy"));
    const msgs = this.agent.state.messages;
    if (seq < 0 || seq >= msgs.length || (msgs[seq] as any).role !== "user") throw new Error(st("onlyUserEdit"));
    store.truncateMessages(this.id, seq);
    this.agent.state.messages = msgs.slice(0, seq);
    this.loadCompaction();
    emit({ type: "messages_reset", sessionId: this.id });
    await this.send(text, images);
  }

  async manualCompact(instructions?: string) {
    if (this.busy) throw new Error(st("sessionBusyCompact"));
    this.prepare();
    await this.compact({ auto: false, instructions, full: true });
  }

  reloadFromDb() {
    if (this.busy) return;
    this.agent.state.messages = store.loadMessages(this.id).map((s) => s.message as AgentMessage);
    this.loadCompaction();
  }

  // ---------- subagents ----------

  private async runSubagent(req: SubagentRequest, signal: AbortSignal | undefined, onProgress: (d: SubagentDetails) => void): Promise<string> {
    const parent = this.info();
    const childInfo = createSession({
      kind: "subagent",
      parentId: this.id,
      title: req.description,
      cwd: parent.cwd,
      providerId: parent.providerId,
      modelId: parent.modelId,
      thinking: parent.thinking,
      permissionMode: parent.permissionMode,
    });
    const child = new SessionRunner(childInfo, this);
    runners.set(childInfo.id, child);
    let toolCalls = 0;
    let last = "";
    const report = (status: SubagentDetails["status"]) => onProgress({ sessionId: childInfo.id, status, lastActivity: last, toolCalls });
    report("running");
    const unsub = child.agent.subscribe((e: any) => {
      if (e.type === "tool_execution_start") {
        toolCalls++;
        last = brief(e.toolName, e.args);
        report("running");
      } else if (e.type === "message_end" && e.message.role === "assistant") {
        const t = textOf(e.message);
        if (t) {
          last = t.split("\n")[0].slice(0, 120);
          report("running");
        }
      }
    });
    const onAbort = () => child.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await child.sendAndWait(req.prompt);
      const msgs = child.agent.state.messages;
      const final = msgs[msgs.length - 1] as any;
      if (signal?.aborted) throw new Error("Subagent aborted");
      if (final?.role === "assistant" && final.stopReason === "error") {
        report("error");
        throw new Error(`Subagent failed: ${final.errorMessage}`);
      }
      report("done");
      const text = textOf(final);
      return text || "(The subagent finished without a text report.)";
    } finally {
      unsub();
      signal?.removeEventListener("abort", onAbort);
      runners.delete(childInfo.id);
    }
  }
}
