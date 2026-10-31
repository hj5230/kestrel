import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import { ChevronRightIcon, CircleDashedIcon, ListTreeIcon } from "lucide-react"
import type {
  AskDetails,
  AssistantMsg,
  CompactionInfo,
  StoredMessage,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultMsg,
  TranscriptView,
} from "@shared/protocol"
import { KestrelMark } from "@/components/kestrel-mark"
import { Markdown } from "./markdown"
import { AssistantMeta, CompactionDivider, ErrorCard, MergeNote, Thinking, UserMessage, type ReplyMeta, type TurnStats } from "./messages"
import { QuestionCard, QuestionSummary } from "./question-card"
import { summary, toolLabel, ToolCallView, type ToolState } from "./tool-call"
import { t, type MessageKey } from "@/lib/i18n"
import type { DetailState } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Runtime {
  results: Map<string, ToolResultMsg>
  running: DetailState["runningTools"]
  runActive: boolean
}

type Step =
  | { k: "thinking"; key: string; block: ThinkingBlock; streaming: boolean }
  | { k: "tool"; key: string; block: ToolCallBlock; msg: AssistantMsg; streaming: boolean }

/** Questions to the user are part of the conversation, not process: they stay in place in every view. */
type Ask = { k: "ask"; key: string; block: ToolCallBlock }

type Item =
  | { k: "user"; key: string; stored: StoredMessage }
  | { k: "compaction"; key: string; c: CompactionInfo }
  | { k: "text"; key: string; text: string; streaming: boolean }
  | { k: "meta"; key: string; meta: ReplyMeta }
  | { k: "aborted"; key: string }
  | Ask
  | Step

type Row =
  | Exclude<Item, Step | { k: "text" }>
  | { k: "text"; key: string; text: string; streaming: boolean; meta?: ReplyMeta }
  | { k: "group"; key: string; steps: Step[]; last: boolean }

function toolState(step: Extract<Step, { k: "tool" }>, rt: Runtime): ToolState {
  const id = step.block.id
  const r = rt.results.get(id)
  if (r) {
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    if (r.isError && /^The user denied|^Operation aborted/.test(text)) return "denied"
    return r.isError ? "error" : "done"
  }
  if (rt.running[id]) return "running"
  if (step.streaming) return "pending"
  if (rt.runActive && step.msg.stopReason === "toolUse") return "pending"
  return "interrupted"
}

const freshTurn = (): TurnStats => ({ calls: 0, tools: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })

function assistantItems(msg: AssistantMsg, keyBase: string, streaming: boolean, seq = -1, turn: TurnStats = freshTurn()): Item[] {
  const out: Item[] = []
  const lastIdx = msg.content.length - 1
  msg.content.forEach((c, i) => {
    const key = `${keyBase}:${i}`
    const live = streaming && i === lastIdx
    if (c.type === "thinking") {
      if (c.thinking.trim()) out.push({ k: "thinking", key, block: c, streaming: live })
    } else if (c.type === "text") {
      if (c.text.trim()) out.push({ k: "text", key, text: c.text, streaming: live })
    } else if (c.type === "toolCall") {
      if (c.name === "ask_user") out.push({ k: "ask", key: c.id || key, block: c })
      else out.push({ k: "tool", key: c.id || key, block: c, msg, streaming })
    }
  })
  if (streaming) return out
  if (msg.stopReason === "aborted") out.push({ k: "aborted", key: `${keyBase}:aborted` })
  if (msg.stopReason !== "toolUse" && msg.content.some((c) => c.type === "text" && c.text.trim())) {
    out.push({ k: "meta", key: `${keyBase}:meta`, meta: { msg, seq, turn: { ...turn } } })
  }
  return out
}

function buildItems(d: DetailState): Item[] {
  const items: Item[] = []
  const byCut = new Map<number, CompactionInfo[]>()
  for (const c of d.compactions) byCut.set(c.cutSeq, [...(byCut.get(c.cutSeq) ?? []), c])
  let maxSeq = -1
  let turn = freshTurn()
  for (const s of d.messages) {
    maxSeq = s.seq
    for (const c of byCut.get(s.seq) ?? []) items.push({ k: "compaction", key: `c${c.id}`, c })
    const m = s.message
    if (m.role === "user") {
      if (!m.merge) turn = freshTurn()
      items.push({ k: "user", key: `u${s.seq}`, stored: s })
    } else if (m.role === "assistant") {
      const u = m.usage
      turn = {
        calls: turn.calls + 1,
        tools: turn.tools + m.content.filter((c) => c.type === "toolCall").length,
        input: turn.input + u.input,
        output: turn.output + u.output,
        cacheRead: turn.cacheRead + u.cacheRead,
        cacheWrite: turn.cacheWrite + u.cacheWrite,
        cost: turn.cost + u.cost.total,
      }
      items.push(...assistantItems(m, `a${s.seq}`, false, s.seq, turn))
    }
  }
  for (const c of d.compactions) if (c.cutSeq > maxSeq) items.push({ k: "compaction", key: `c${c.id}`, c })
  if (d.streaming) items.push(...assistantItems(d.streaming, "stream", true))
  return items
}

function attachMeta(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    if (row.k === "meta" && prev?.k === "text" && !prev.meta) prev.meta = row.meta
    else out.push(row.k === "text" ? { ...row } : row)
  }
  return out
}

function toRows(items: Item[], view: TranscriptView): Row[] {
  if (view === "detailed" || view === "verbose") {
    return attachMeta(items.map((it) => (it.k === "thinking" || it.k === "tool" ? { k: "group", key: it.key, steps: [it], last: false } : it)))
  }
  const rows: Row[] = []
  let current: Step[] = []
  const flush = () => {
    if (current.length) rows.push({ k: "group", key: `g:${current[0].key}`, steps: current, last: false })
    current = []
  }
  for (const it of items) {
    if (it.k === "thinking" || it.k === "tool") current.push(it)
    else if (it.k === "meta" || it.k === "aborted") rows.push(it)
    else {
      flush()
      rows.push(it)
    }
  }
  flush()
  rows.splice(0, rows.length, ...attachMeta(rows))
  const lastGroup = rows.length && rows[rows.length - 1].k === "group" ? (rows[rows.length - 1] as Extract<Row, { k: "group" }>) : null
  if (lastGroup) lastGroup.last = true
  return rows
}

const CATEGORY: Record<string, string> = {
  bash: "commands",
  bash_output: "commands",
  kill_shell: "commands",
  read: "reads",
  ls: "searches",
  glob: "searches",
  grep: "searches",
  search_sessions: "searches",
  read_session: "reads",
  edit: "edits",
  write: "edits",
  web_fetch: "web",
  web_search: "web",
  task: "subagents",
  memory_search: "memory",
  memory_read: "memory",
  memory_write: "memory",
  memory_delete: "memory",
  todo_write: "plan",
  ask_user: "questions",
}
const ORDER = ["commands", "reads", "searches", "edits", "web", "subagents", "memory", "questions", "mcp", "other", "plan"]

function plural(base: string, n: number) {
  return t(`group.${base}.${n === 1 ? "one" : "other"}` as MessageKey, { n })
}

function describeGroup(steps: Step[]): string {
  const counts = new Map<string, number>()
  const editPaths = new Set<string>()
  for (const s of steps) {
    if (s.k !== "tool") continue
    const name = s.block.name
    const cat = name.startsWith("mcp__") ? "mcp" : (CATEGORY[name] ?? "other")
    if (cat === "edits") {
      editPaths.add(String(s.block.arguments?.path ?? s.key))
      counts.set("edits", editPaths.size)
    } else counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  if (!counts.size) return t("group.thought")
  const parts = ORDER.filter((c) => counts.has(c)).map((c) => (c === "plan" ? t("group.plan") : plural(c, counts.get(c)!)))
  const text = parts.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function StepView({ step, rt, expand, onOpenSubagent }: { step: Step; rt: Runtime; expand: boolean; onOpenSubagent?: (id: string) => void }) {
  if (step.k === "thinking") return <Thinking text={step.block.thinking} streaming={step.streaming} defaultOpen={expand} />
  const running = rt.running[step.block.id]
  return (
    <ToolCallView
      call={step.block}
      result={rt.results.get(step.block.id)}
      partial={running?.partial}
      state={toolState(step, rt)}
      onOpenSubagent={onOpenSubagent}
      expand={expand}
    />
  )
}

function ProcessGroup({
  steps,
  rt,
  waiting,
  expandable,
  onOpenSubagent,
}: {
  steps: Step[]
  rt: Runtime
  waiting: boolean
  expandable: boolean
  onOpenSubagent?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const states = steps.map((s) => (s.k === "tool" ? toolState(s, rt) : s.streaming ? "running" : "done"))
  const active = states.some((s) => s === "running" || s === "pending")
  const failed = states.filter((s) => s === "error").length
  let activity = ""
  if (active) {
    let idx = states.length - 1
    while (idx > 0 && states[idx] !== "running" && states[idx] !== "pending") idx--
    const step = steps[idx]
    activity = step.k === "thinking" ? t("group.thinking") : `${toolLabel(step.block.name)} ${summary(step.block)}`.trim()
  }
  const label = waiting ? t("group.waiting") : active ? activity || t("group.working") : describeGroup(steps)
  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-muted-foreground transition-colors pointer-coarse:min-h-10",
          expandable && "hover:bg-muted/70 hover:text-foreground",
          open && "bg-muted/50 text-foreground",
        )}
      >
        {waiting ? (
          <CircleDashedIcon className="size-3.5 shrink-0 text-warning" />
        ) : active ? (
          <KestrelMark />
        ) : (
          <ListTreeIcon className="size-3.5 shrink-0" />
        )}
        <span className={cn("min-w-0 truncate", active && !waiting && "text-shimmer")}>{label}</span>
        {failed > 0 && <span className="shrink-0 text-xs text-destructive">· {t("group.failed", { n: failed })}</span>}
        {expandable && <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="mt-1 ml-3.5 flex flex-col gap-1.5 border-l pl-3">
          {steps.map((s) => (
            <StepView key={s.key} step={s} rt={rt} expand={false} onOpenSubagent={onOpenSubagent} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Rows mounted at first, and how many more each time the reader nears the top. Long sessions used to mount
 *  every message (and highlight every code block) before showing anything. */
const WINDOW = 40

/** Mounts the last `limit` rows; a sentinel above them grows the window, keeping the reader's place. */
function useRowWindow(total: number) {
  const [limit, setLimit] = useState(WINDOW)
  const sentinel = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ el: HTMLElement; height: number; top: number } | null>(null)
  const hidden = Math.max(0, total - limit)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hidden) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        const scroller = el.closest("[data-transcript-scroll]") as HTMLElement | null
        if (scroller) anchor.current = { el: scroller, height: scroller.scrollHeight, top: scroller.scrollTop }
        setLimit((n) => n + WINDOW)
      },
      { rootMargin: "800px 0px 0px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hidden > 0, limit])
  // Rows were added above the reader: move down by exactly what was added, so nothing on screen shifts.
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    anchor.current = null
    a.el.scrollTop = a.top + (a.el.scrollHeight - a.height)
  }, [limit])
  return { start: hidden, sentinel: hidden ? <div ref={sentinel} className="h-px" aria-hidden="true" /> : null }
}

function spacing(row: Row, prev: Row | undefined) {
  if (!prev) return ""
  if (row.k === "user" || prev.k === "user" || row.k === "compaction" || prev.k === "compaction") return "mt-6"
  if (row.k === "meta") return "mt-1"
  if (row.k === "ask" || prev.k === "ask") return "mt-3"
  if (row.k === "text" || prev.k === "text") return "mt-3"
  return "mt-1.5"
}

export function Transcript({
  d,
  view,
  readOnly,
  onOpenSubagent,
  onEdit,
  onFork,
  onRetry,
}: {
  d: DetailState
  view: TranscriptView
  readOnly?: boolean
  onOpenSubagent?: (id: string) => void
  onEdit?: (seq: number, text: string) => void
  onFork?: (seq: number) => void
  onRetry?: () => void
}) {
  const results = useMemo(() => {
    const map = new Map<string, ToolResultMsg>()
    for (const s of d.messages) if (s.message.role === "toolResult") map.set(s.message.toolCallId, s.message)
    return map
  }, [d.messages])
  const running = d.session.status === "running" || d.session.status === "waiting"
  const rt: Runtime = { results, running: d.runningTools, runActive: running }
  const rows = useMemo(() => toRows(buildItems(d), view), [d.messages, d.streaming, d.compactions, view])
  const lastRow = rows[rows.length - 1]
  const last = d.messages[d.messages.length - 1]
  const lastAssistantError = !running && last?.message.role === "assistant" && last.message.stopReason === "error" ? (last.message as AssistantMsg) : null
  const configError = !running && d.session.status === "error" && !lastAssistantError && d.session.lastError
  // Before anything of the reply is visible the row says what is actually happening, not "Thinking".
  const pending = running && !!d.phase && d.approvals.length === 0 && d.questions.length === 0
  const busy = pending || (running && (!lastRow || lastRow.k === "user" || lastRow.k === "compaction") && d.approvals.length === 0 && d.questions.length === 0)
  const waiting = d.approvals.length > 0 || d.questions.length > 0

  const win = useRowWindow(rows.length)
  const rendered: preact.JSX.Element[] = []
  rows.forEach((row, i) => {
    if (i < win.start) return
    const cls = spacing(row, rows[i - 1])
    let el: preact.JSX.Element | null = null
    switch (row.k) {
      case "user":
        el = row.stored.message.role === "user" && row.stored.message.merge ? (
          <MergeNote merge={row.stored.message.merge} />
        ) : (
          <UserMessage stored={row.stored} canEdit={!readOnly && !running} onEdit={(seq, text) => onEdit?.(seq, text)} onFork={(seq) => onFork?.(seq)} />
        )
        break
      case "compaction":
        el = <CompactionDivider c={row.c} />
        break
      case "text":
        el = row.meta ? (
          <div className="group/assistant">
            <Markdown text={row.text} streaming={row.streaming} />
            <AssistantMeta meta={row.meta} hover onFork={readOnly ? undefined : onFork} />
          </div>
        ) : (
          <Markdown text={row.text} streaming={row.streaming} />
        )
        break
      case "meta":
        el = <AssistantMeta meta={row.meta} onFork={readOnly ? undefined : onFork} />
        break
      case "ask": {
        const pending = d.questions.find((q) => q.toolCallId === row.block.id)
        const result = results.get(row.block.id)
        if (pending) el = <QuestionCard req={pending} readOnly={readOnly} />
        else if (result?.details) el = <QuestionSummary details={result.details as AskDetails} />
        // Still streaming the call, or it failed before asking: the process row shows those states.
        else el = <ProcessGroup steps={[{ k: "tool", key: row.key, block: row.block, msg: d.streaming ?? ({} as AssistantMsg), streaming: !result }]} rt={rt} waiting={false} expandable={view !== "answer"} />
        break
      }
      case "aborted":
        el = <div className="text-xs text-muted-foreground">{t("msg.stopped")}</div>
        break
      case "group": {
        const groupActive = row.last && running
        if (view === "answer") {
          if (!groupActive) return
          el = <ProcessGroup steps={row.steps} rt={rt} waiting={waiting} expandable={false} />
        } else if (view === "compact") {
          el = <ProcessGroup steps={row.steps} rt={rt} waiting={groupActive && waiting} expandable onOpenSubagent={onOpenSubagent} />
        } else {
          el = <StepView step={row.steps[0]} rt={rt} expand={view === "verbose"} onOpenSubagent={onOpenSubagent} />
        }
        break
      }
    }
    if (el) {
      rendered.push(
        <div key={`${view}:${row.key}`} className={cls}>
          {el}
        </div>,
      )
    }
  })

  return (
    <div className="flex flex-col">
      {win.sentinel}
      {rendered}
      {(busy || d.compacting) && (
        <div className={cn("flex items-center gap-2 text-[13px] text-muted-foreground", rendered.length && "mt-6")}>
          <KestrelMark />
          <span className="text-shimmer">{d.compacting ? t("chat.compacting") : t(`phase.${d.phase ?? "preparing"}` as MessageKey)}</span>
        </div>
      )}
      {lastAssistantError && (
        <div className="mt-4">
          <ErrorCard message={lastAssistantError.errorMessage ?? t("common.unknownError")} onRetry={readOnly ? undefined : onRetry} />
        </div>
      )}
      {configError && (
        <div className="mt-4">
          <ErrorCard message={d.session.lastError!} onRetry={readOnly || last?.message.role !== "user" ? undefined : onRetry} />
        </div>
      )}
    </div>
  )
}
