import { useMemo, useState } from "preact/hooks"
import {
  BrainIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  PencilIcon,
  RotateCcwIcon,
  ShrinkIcon,
  TriangleAlertIcon,
  CheckIcon,
} from "lucide-react"
import type { AssistantMsg, CompactionInfo, StoredMessage, ToolResultMsg, UserMsg } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Markdown } from "./markdown"
import { ToolCallView, type ToolState } from "./tool-call"
import { formatCost, formatTokens, clockTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            navigator.clipboard.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          }}
        >
          {done ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("common.copy")}</TooltipContent>
    </Tooltip>
  )
}

export function userText(m: UserMsg): string {
  const display = (m as any).display
  if (display) return display
  if (typeof m.content === "string") return m.content
  return m.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n")
}

function userImages(m: UserMsg) {
  if (typeof m.content === "string") return []
  return m.content.filter((c) => c.type === "image") as { data: string; mimeType: string }[]
}

export function UserMessage({
  stored,
  canEdit,
  onEdit,
  onFork,
}: {
  stored: StoredMessage
  canEdit: boolean
  onEdit: (seq: number, text: string) => void
  onFork: (seq: number) => void
}) {
  const m = stored.message as UserMsg
  const text = userText(m)
  const images = userImages(m)
  const isCommand = !!(m as any).display
  const [preview, setPreview] = useState<string | null>(null)
  return (
    <div className="group/user flex flex-col items-end gap-1">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((img, i) => {
            const src = `data:${img.mimeType};base64,${img.data}`
            return (
              <button key={i} type="button" onClick={() => setPreview(src)} className="overflow-hidden rounded-lg border">
                <img src={src} className="h-24 max-w-48 object-cover" />
              </button>
            )
          })}
        </div>
      )}
      {text && (
        <div
          className={cn(
            "max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[0.94rem] leading-relaxed whitespace-pre-wrap break-words",
            isCommand && "font-mono text-[13px]",
          )}
        >
          {text}
        </div>
      )}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100">
        <span className="mr-1 text-[11px] text-muted-foreground">{clockTime(m.timestamp)}</span>
        <CopyButton text={text} />
        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => onEdit(stored.seq, text)}>
                <PencilIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("msg.editResend")}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={() => onFork(stored.seq)}>
              <GitBranchIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("msg.fork")}</TooltipContent>
        </Tooltip>
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("common.image")}</DialogTitle>
          </DialogHeader>
          {preview && <img src={preview} className="max-h-[75vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const firstLine = text.trim().split("\n").filter(Boolean).pop()?.slice(0, 120) ?? ""
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-[13px] text-muted-foreground hover:text-foreground">
          <BrainIcon className="size-3.5 shrink-0" />
          <span className={cn("shrink-0", streaming && "text-shimmer")}>{streaming ? t("msg.thinking") : t("msg.thoughts")}</span>
          {!open && streaming && <span className="truncate text-xs opacity-70">{firstLine}</span>}
          <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-1.5 border-l-2 pl-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{text}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export interface ToolRuntime {
  results: Map<string, ToolResultMsg>
  running: Record<string, { partial: any; startedAt: number }>
  runActive: boolean
}

function toolState(id: string, rt: ToolRuntime, msg: AssistantMsg): ToolState {
  const r = rt.results.get(id)
  if (r) {
    const t = r.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    if (r.isError && /^The user denied|^Operation aborted/.test(t)) return "denied"
    return r.isError ? "error" : "done"
  }
  if (rt.running[id]) return "running"
  if (rt.runActive && msg.stopReason === "toolUse") return "pending"
  return "interrupted"
}

export function AssistantMessage({
  msg,
  rt,
  streaming,
  onOpenSubagent,
  showMeta,
}: {
  msg: AssistantMsg
  rt: ToolRuntime
  streaming?: boolean
  onOpenSubagent?: (id: string) => void
  showMeta?: boolean
}) {
  const text = msg.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n\n")
  const lastIdx = msg.content.length - 1
  return (
    <div className="group/assistant flex flex-col gap-1.5">
      {msg.content.map((c, i) => {
        if (c.type === "thinking") {
          if (!c.thinking.trim()) return null
          return <Thinking key={i} text={c.thinking} streaming={!!streaming && i === lastIdx} />
        }
        if (c.type === "text") {
          if (!c.text.trim()) return null
          return <Markdown key={i} text={c.text} streaming={!!streaming && i === lastIdx} />
        }
        if (c.type === "toolCall") {
          const running = rt.running[c.id]
          const state = streaming ? "running" : toolState(c.id, rt, msg)
          return (
            <ToolCallView
              key={c.id || i}
              call={c}
              result={rt.results.get(c.id)}
              partial={running?.partial}
              state={streaming && !running ? "pending" : state}
              onOpenSubagent={onOpenSubagent}
            />
          )
        }
        return null
      })}
      {msg.stopReason === "aborted" && <div className="text-xs text-muted-foreground">{t("msg.stopped")}</div>}
      {showMeta && !streaming && text && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/assistant:opacity-100">
          <CopyButton text={text} />
          <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">
            {t("msg.usage", { model: msg.model, input: formatTokens(msg.usage.input + msg.usage.cacheRead + msg.usage.cacheWrite), output: formatTokens(msg.usage.output) })}
            {msg.usage.cost.total > 0 && ` · ${formatCost(msg.usage.cost.total)}`} · {clockTime(msg.timestamp)}
          </span>
        </div>
      )}
    </div>
  )
}

export function CompactionDivider({ c }: { c: CompactionInfo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted">
          <ShrinkIcon className="size-3" />
          {c.auto ? t("msg.autoCompacted") : t("msg.compacted")} · {t("msg.compactedFrom", { n: formatTokens(c.tokensBefore) })}
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("msg.summary")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-2">
            <Markdown text={c.summary} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-destructive">{t("msg.failed")}</div>
        <div className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">{message}</div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcwIcon />
          {t("common.retry")}
        </Button>
      )}
    </div>
  )
}

export function useToolResults(messages: StoredMessage[]) {
  return useMemo(() => {
    const map = new Map<string, ToolResultMsg>()
    for (const s of messages) if (s.message.role === "toolResult") map.set(s.message.toolCallId, s.message)
    return map
  }, [messages])
}
