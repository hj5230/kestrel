// What an expanded tool call shows: output, diffs, todo lists, and a subagent's progress.
import { useState } from "preact/hooks"
import { BotIcon, ChevronRightIcon, CircleDashedIcon, CircleIcon, CircleCheckIcon, ExternalLinkIcon } from "lucide-react"
import type { BashDetails, EditDetails, SubagentDetails, Todo, ToolCallBlock, ToolResultMsg } from "@shared/protocol"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { DiffView, simpleDiff } from "./diff-view"
import { formatDuration } from "@/lib/format"
import { highlight, languageFromPath } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { ICONS, resultText, type ToolState } from "./tool-meta"

/** `live` is false once the turn that wrote the list is over: nothing is in progress any more. */
export function TodoList({ todos, live = true }: { todos: Todo[]; live?: boolean }) {
  return (
    <ul className="grid gap-1 py-1">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          {t.status === "completed" ? (
            <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : t.status === "in_progress" ? (
            <CircleDashedIcon className={cn("mt-0.5 size-3.5 shrink-0", live ? "animate-spin text-primary [animation-duration:3s]" : "text-muted-foreground")} />
          ) : (
            <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span className={cn(t.status === "completed" && "text-muted-foreground line-through decoration-muted-foreground/40", live && t.status === "in_progress" && "font-medium")}>
            {live && t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function OutputBlock({ text, className, language }: { text: string; className?: string; language?: string }) {
  if (!text) return <div className="px-3 py-2 text-xs text-muted-foreground">{t("tool.noOutput")}</div>
  return (
    <pre className={cn("max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-all", className)}>
      {language ? <code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(text, language) }} /> : text}
    </pre>
  )
}

export function stripLineNumbers(t: string) {
  return t
    .split("\n")
    .map((l) => l.replace(/^\s*\d+\t/, ""))
    .join("\n")
}

export function Body({ call, result, partial, state }: { call: ToolCallBlock; result?: ToolResultMsg; partial?: any; state: ToolState }) {
  const a = call.arguments ?? {}
  const details = (result?.details ?? partial) as any
  const text = resultText(result)

  if (call.name === "bash" || call.name === "bash_output") {
    const d = details as BashDetails | undefined
    const out = d?.output ?? (result ? text : "")
    return (
      <div className="bg-code">
        {call.name === "bash" && (
          <div className="border-b border-border/60 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-all select-text">
            <span className="select-none text-muted-foreground">$ </span>
            {a.command}
          </div>
        )}
        <OutputBlock text={state === "running" ? out : out || text} />
        {d && d.exitCode !== null && d.exitCode !== undefined && (
          <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
            <span className={cn(d.exitCode === 0 ? "text-success" : "text-destructive")}>exit {d.exitCode}</span>
            <span>{formatDuration(d.durationMs)}</span>
            {d.timedOut && <span className="text-destructive">{t("tool.timedOut")}</span>}
          </div>
        )}
      </div>
    )
  }
  if (call.name === "edit" || call.name === "write") {
    const d = details as EditDetails | undefined
    const diff = d?.diff ?? (call.name === "edit" ? simpleDiff(a.old_string ?? "", a.new_string ?? "") : simpleDiff("", a.content ?? ""))
    return (
      <>
        <DiffView diff={diff} />
        {state === "error" && <OutputBlock text={text} className="border-t text-destructive" />}
      </>
    )
  }
  if (call.name === "read" && !result?.isError) {
    const img = result?.content.find((c) => c.type === "image") as any
    if (img) return <img src={`data:${img.mimeType};base64,${img.data}`} className="max-h-80 p-2" />
    return <OutputBlock text={stripLineNumbers(text)} language={languageFromPath(String(a.path ?? ""))} />
  }
  if (call.name === "web_search" && details?.results) {
    return (
      <ul className="grid gap-2 px-3 py-2 select-text">
        {details.results.map((r: any, i: number) => (
          <li key={i} className="text-[13px]">
            <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              {r.title}
            </a>
            <div className="truncate text-xs text-muted-foreground">{r.url}</div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</div>
          </li>
        ))}
      </ul>
    )
  }
  if (call.name === "memory_write") {
    return (
      <div className="select-text">
        <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">{a.description}</div>
        <OutputBlock text={a.content ?? ""} />
        {state === "error" && <OutputBlock text={text} className="border-t text-destructive" />}
      </div>
    )
  }
  const showArgs = call.name.startsWith("mcp__") || !ICONS[call.name]
  return (
    <>
      {showArgs && <OutputBlock text={JSON.stringify(a, null, 2)} language="json" className="border-b border-border/60" />}
      {(result || state !== "running") && <OutputBlock text={text} className={cn(result?.isError && "text-destructive")} />}
    </>
  )
}

export function SubagentCard({
  call,
  result,
  partial,
  state,
  onOpen,
  expand,
}: {
  call: ToolCallBlock
  result?: ToolResultMsg
  partial?: any
  state: ToolState
  onOpen?: (id: string) => void
  expand?: boolean
}) {
  const d = (partial ?? result?.details) as SubagentDetails | undefined
  const [open, setOpen] = useState(!!expand)
  const text = resultText(result)
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {state === "running" ? <Spinner className="size-3.5" /> : <BotIcon className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{call.arguments?.description ?? t("tool.task")}</div>
          <div className={cn("truncate text-xs text-muted-foreground", state === "running" && "text-shimmer")}>
            {state === "running" ? d?.lastActivity || t("tool.starting") : state === "error" ? t("tool.failed") : state === "done" ? t("tool.done") : t("tool.interrupted")}
            {d?.toolCalls ? t("tool.calls", { n: d.toolCalls }) : ""}
          </div>
        </div>
        {d?.sessionId && onOpen && (
          <Button variant="ghost" size="xs" onClick={() => onOpen(d.sessionId)}>
            <ExternalLinkIcon />
            {t("tool.viewRun")}
          </Button>
        )}
        {result && (
          <Button variant="ghost" size="icon-xs" aria-label={t("tool.toggleDetails")} aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
          </Button>
        )}
      </div>
      {open && result && <OutputBlock text={text} className={cn("border-t bg-muted/30", result.isError && "text-destructive")} />}
    </div>
  )
}
