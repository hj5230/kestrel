import { useMemo } from "preact/hooks"
import type { AskDetails, AssistantMsg, ToolResultMsg, TranscriptView } from "@shared/protocol"
import { KestrelMark } from "@/components/kestrel-mark"
import { Markdown } from "./markdown"
import { AssistantMeta, CompactionDivider, ErrorCard, MergeNote, UserMessage } from "./messages"
import { QuestionCard, QuestionSummary } from "./question-card"
import { t, type MessageKey } from "@/lib/i18n"
import type { DetailState } from "@/lib/store"
import { cn } from "@/lib/utils"
import { StepView, ProcessGroup } from "./process-group"
import { buildItems, toRows, type Runtime, type Row } from "./transcript-rows"
import { useRowWindow } from "./use-row-window"

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
        el = (
          <div className="group/assistant">
            <AssistantMeta meta={row.meta} hover onFork={readOnly ? undefined : onFork} />
          </div>
        )
        break
      case "ask": {
        const pending = d.questions.find((q) => q.toolCallId === row.block.id)
        const result = results.get(row.block.id)
        if (pending) el = <QuestionCard req={pending} readOnly={readOnly} />
        // A call that failed before asking (e.g. it arrived without arguments) has a result with no questions.
        else if (Array.isArray((result?.details as AskDetails | undefined)?.questions)) el = <QuestionSummary details={result!.details as AskDetails} />
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
