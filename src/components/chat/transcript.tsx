import { useMemo, useState } from "preact/hooks"
import { ChevronRightIcon, CircleDashedIcon, ListTreeIcon } from "lucide-react"
import type {
  AssistantMsg,
  CompactionInfo,
  StoredMessage,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultMsg,
  TranscriptView,
} from "@shared/protocol"
import { Spinner } from "@/components/ui/spinner"
import { Markdown } from "./markdown"
import { AssistantMeta, CompactionDivider, ErrorCard, Thinking, UserMessage } from "./messages"
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

type Item =
  | { k: "user"; key: string; stored: StoredMessage }
  | { k: "compaction"; key: string; c: CompactionInfo }
  | { k: "text"; key: string; text: string; streaming: boolean }
  | { k: "meta"; key: string; msg: AssistantMsg }
  | { k: "aborted"; key: string }
  | Step

type Row =
  | Exclude<Item, Step | { k: "text" }>
  | { k: "text"; key: string; text: string; streaming: boolean; meta?: AssistantMsg }
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

function assistantItems(msg: AssistantMsg, keyBase: string, streaming: boolean): Item[] {
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
      out.push({ k: "tool", key: c.id || key, block: c, msg, streaming })
    }
  })
  if (streaming) return out
  if (msg.stopReason === "aborted") out.push({ k: "aborted", key: `${keyBase}:aborted` })
  if (msg.stopReason !== "toolUse" && msg.content.some((c) => c.type === "text" && c.text.trim())) {
    out.push({ k: "meta", key: `${keyBase}:meta`, msg })
  }
  return out
}

function buildItems(d: DetailState): Item[] {
  const items: Item[] = []
  const byCut = new Map<number, CompactionInfo[]>()
  for (const c of d.compactions) byCut.set(c.cutSeq, [...(byCut.get(c.cutSeq) ?? []), c])
  let maxSeq = -1
  for (const s of d.messages) {
    maxSeq = s.seq
    for (const c of byCut.get(s.seq) ?? []) items.push({ k: "compaction", key: `c${c.id}`, c })
    const m = s.message
    if (m.role === "user") items.push({ k: "user", key: `u${s.seq}`, stored: s })
    else if (m.role === "assistant") items.push(...assistantItems(m, `a${s.seq}`, false))
  }
  for (const c of d.compactions) if (c.cutSeq > maxSeq) items.push({ k: "compaction", key: `c${c.id}`, c })
  if (d.streaming) items.push(...assistantItems(d.streaming, "stream", true))
  return items
}

function attachMeta(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    if (row.k === "meta" && prev?.k === "text" && !prev.meta) prev.meta = row.msg
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
  todo_write: "plan",
}
const ORDER = ["commands", "reads", "searches", "edits", "web", "subagents", "mcp", "other", "plan"]

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
          "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-muted-foreground transition-colors",
          expandable && "hover:bg-muted/70 hover:text-foreground",
          open && "bg-muted/50 text-foreground",
        )}
      >
        {waiting ? (
          <CircleDashedIcon className="size-3.5 shrink-0 text-warning" />
        ) : active ? (
          <Spinner className="size-3.5 shrink-0" />
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

function spacing(row: Row, prev: Row | undefined) {
  if (!prev) return ""
  if (row.k === "user" || prev.k === "user" || row.k === "compaction" || prev.k === "compaction") return "mt-6"
  if (row.k === "meta") return "mt-1"
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
  const rows = toRows(buildItems(d), view)
  const lastRow = rows[rows.length - 1]
  const last = d.messages[d.messages.length - 1]
  const lastAssistantError = !running && last?.message.role === "assistant" && last.message.stopReason === "error" ? (last.message as AssistantMsg) : null
  const configError = !running && d.session.status === "error" && !lastAssistantError && d.session.lastError
  const busy = running && (!lastRow || lastRow.k === "user" || lastRow.k === "compaction") && d.approvals.length === 0
  const waiting = d.approvals.length > 0

  const rendered: preact.JSX.Element[] = []
  rows.forEach((row, i) => {
    const cls = spacing(row, rows[i - 1])
    let el: preact.JSX.Element | null = null
    switch (row.k) {
      case "user":
        el = <UserMessage stored={row.stored} canEdit={!readOnly && !running} onEdit={(seq, text) => onEdit?.(seq, text)} onFork={(seq) => onFork?.(seq)} />
        break
      case "compaction":
        el = <CompactionDivider c={row.c} />
        break
      case "text":
        el = row.meta ? (
          <div className="group/assistant">
            <Markdown text={row.text} streaming={row.streaming} />
            <AssistantMeta msg={row.meta} hover />
          </div>
        ) : (
          <Markdown text={row.text} streaming={row.streaming} />
        )
        break
      case "meta":
        el = <AssistantMeta msg={row.msg} />
        break
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
      {rendered}
      {(busy || d.compacting) && (
        <div className={cn("flex items-center gap-2 text-[13px] text-muted-foreground", rendered.length && "mt-6")}>
          <Spinner className="size-3.5" />
          <span className="text-shimmer">{d.compacting ? t("chat.compacting") : t("chat.thinking")}</span>
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
