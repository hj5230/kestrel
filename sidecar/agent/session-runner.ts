// One session's agent: its run state and lifecycle (send, queue, retry, edit, abort). The rest of a run lives
// in the sibling modules it calls into.
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { type ImageContent, type Message } from "@mariozechner/pi-ai";
import type { AssistantMsg, ChatMessage, ContextBreakdown, FileAttachment, QueuedMessage, SessionDetail, SessionInfo, RunPhase } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";
import { createVercelStreamFn } from "../llm/vercel-stream";
import { st } from "../i18n";
import { languageModel, toPiModel } from "../providers";
import { newId } from "../sessions";
import { expandSlashCommand } from "../skills";
import { killSessionShells } from "../tools/bash";
import { MemoryContext } from "../memory-context";
import * as setup from "./setup";
import * as context from "./context";
import * as gate from "./gate";
import * as events from "./events";
import * as turn from "./turn";
import { approvals, pendingQuestions } from "./pending";
import { fileAttachmentMarkdown } from "./text";

export class SessionRunner {
  // The runner is spread over agent/ by concern (setup, turn, context, gate, events, subagents); those modules read
  // and update the run state below directly, so it is not private.
  readonly id: string;
  readonly agent: Agent;
  readonly parent: SessionRunner | null;
  readonly rootId: string;
  readFiles = new Map<string, number>();
  memoryContext = new MemoryContext();
  queued: (QueuedMessage & { ts: number; msg: AgentMessage })[] = [];
  streaming: AssistantMsg | null = null;
  phase: RunPhase | null = null;
  runningTools: SessionDetail["runningTools"] = {};
  compacting = false;
  compaction: { cutSeq: number; summary: string; at: number } | null = null;
  toolStarted = new Map<string, number>();
  lastStreamEmit = 0;
  streamTimer: ReturnType<typeof setTimeout> | null = null;
  toolEmitAt = new Map<string, number>();
  runPromise: Promise<void> | null = null;
  overflowRetried = false;
  stopRequested = false;

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
      streamFn: createVercelStreamFn((m) => ({ model: languageModel(m.provider, m.id), kind: store.getProvider(m.provider)?.kind })),
      convertToLlm: (msgs) =>
        msgs.filter((m: any) => m.role === "user" || m.role === "toolResult" || (m.role === "assistant" && m.content?.length)) as Message[],
      transformContext: (msgs, signal) => context.transformContext(this, msgs, signal),
      beforeToolCall: (ctx, signal) => gate.beforeToolCall(this, ctx, signal),
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
    this.agent.subscribe((e) => events.onEvent(this, e));
  }

  info(): SessionInfo {
    const s = store.getSession(this.id);
    if (!s) throw new Error(st("sessionNotFound"));
    return s;
  }

  get busy() {
    return this.agent.state.isStreaming || this.compacting;
  }

  emitSession() {
    const s = store.getSession(this.id);
    if (s) emit({ type: "session_updated", session: s });
  }

  setPhase(phase: RunPhase | null) {
    if (this.phase === phase) return;
    this.phase = phase;
    emit({ type: "phase", sessionId: this.id, phase });
  }

  emitQueue() {
    emit({ type: "queue", sessionId: this.id, queued: this.queued.map(({ id, text, mode, files }) => ({ id, text, mode, files })) });
  }

  loadCompaction() {
    const list = store.listCompactions(this.id);
    const last = list[list.length - 1];
    this.compaction = last ? { cutSeq: last.cutSeq, summary: last.summary, at: last.createdAt } : null;
  }

  /** Auto-review bookkeeping, shared by the session and its subagents. */
  /** Actions the user approved by hand in this session, newest last, for the auto reviewer. */
  gate: { approved: string[] } = { approved: [] };

  root(): SessionRunner {
    return this.parent ? this.parent.root() : this;
  }

  titlePending = false;
  async send(text: string, images: ImageContent[] = [], files: FileAttachment[] = [], mode: "auto" | "steer" | "followUp" = "auto"): Promise<void> {
    const cwd = this.info().cwd;
    const expanded = text.startsWith("/") ? expandSlashCommand(cwd, text) : null;
    const bodyBase = expanded ?? text;
    const body = files.length ? `${bodyBase}${bodyBase ? "\n\n" : ""}${fileAttachmentMarkdown(files)}` : bodyBase;
    const msg: any = {
      role: "user",
      content: images.length ? [{ type: "text", text: body }, ...images] : body,
      timestamp: Date.now(),
    };
    if (files.length) msg.files = files;
    // display is only for showing a slash command instead of its expansion. The attachment block stays in the
    // text, so the transcript and the export both show the file instead of hiding it behind the typed text.
    if (expanded) msg.display = text;
    if (this.busy) {
      const qmode = mode === "followUp" ? "followUp" : "steer";
      if (qmode === "followUp" || this.compacting) this.agent.followUp(msg);
      else this.agent.steer(msg);
      this.queued.push({ id: newId("q_"), text, mode: qmode, files, ts: msg.timestamp, msg });
      this.emitQueue();
      return;
    }
    turn.start(this, () => this.agent.prompt(msg)).catch(() => {});
  }

  async sendAndWait(text: string): Promise<void> {
    await turn.start(this, () => this.agent.prompt(text)).catch(() => {});
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
    this.stopRequested = true;
    for (const a of approvals.values()) if (a.owner === this) a.resolve({ decision: "deny", reason: "aborted" });
    for (const q of pendingQuestions.values()) if (q.owner === this) q.resolve(null);
    this.agent.clearAllQueues();
    this.queued = [];
    this.emitQueue();
    this.agent.abort();
    killSessionShells(this.id);
  }

  dropTrailingFailure() {
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
    turn.start(this, () => this.agent.continue()).catch(() => {});
  }

  async editAndResend(seq: number, text: string, images: ImageContent[] = [], files: FileAttachment[] = []) {
    if (this.busy) throw new Error(st("sessionBusy"));
    const msgs = this.agent.state.messages;
    if (seq < 0 || seq >= msgs.length || (msgs[seq] as any).role !== "user") throw new Error(st("onlyUserEdit"));
    store.truncateMessages(this.id, seq);
    this.agent.state.messages = msgs.slice(0, seq);
    this.loadCompaction();
    emit({ type: "messages_reset", sessionId: this.id });
    await this.send(text, images, files);
  }

  /** Adds a message that is not a turn (a merge note): stored, in the model's context, no run started. */
  appendNote(msg: ChatMessage) {
    if (this.busy) throw new Error(st("sessionBusy"));
    const stored = store.appendMessage(this.id, msg);
    this.agent.state.messages = [...this.agent.state.messages, msg as AgentMessage];
    emit({ type: "message_appended", sessionId: this.id, stored });
    this.emitSession();
  }

  async manualCompact(instructions?: string) {
    if (this.busy) throw new Error(st("sessionBusyCompact"));
    setup.prepare(this);
    await context.compact(this, { auto: false, instructions, full: true });
  }

  reloadFromDb() {
    if (this.busy) return;
    this.agent.state.messages = store.loadMessages(this.id).map((s) => s.message as AgentMessage);
    this.loadCompaction();
  }

  /** Where the context window goes; see context.ts. */
  contextBreakdown(): ContextBreakdown {
    return context.contextBreakdown(this);
  }

  compact(opts: Parameters<typeof context.compact>[1]) {
    return context.compact(this, opts);
  }
}
