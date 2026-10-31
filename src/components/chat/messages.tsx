import type { ComponentChildren } from "preact"
import { useLayoutEffect, useRef, useState } from "preact/hooks"
import {
  BrainIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  GitBranchIcon,
  GitMergeIcon,
  InfoIcon,
  PencilIcon,
  RotateCcwIcon,
  ShrinkIcon,
  TriangleAlertIcon,
  CheckIcon,
} from "lucide-react"
import type { AssistantMsg, CompactionInfo, StoredMessage, UserMsg } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Markdown } from "./markdown"
import { Panel } from "./pickers"
import { formatCost, formatTokens, clockTime } from "@/lib/format"
import { findModel, providerName } from "@/lib/store"
import { cn } from "@/lib/utils"
import { locale, t, type MessageKey } from "@/lib/i18n"

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("common.copy")}
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

/** The runner appends one "[Attached file]" block per file to the text the model sees. The transcript shows chips instead. */
const ATTACHED_BLOCK = /\n*\[Attached file\]\n- path: [\s\S]*$/

export function userText(m: UserMsg): string {
  const display = (m as any).display
  if (display) return display
  const raw =
    typeof m.content === "string"
      ? m.content
      : m.content
          .filter((c) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
  return m.files?.length ? raw.replace(ATTACHED_BLOCK, "") : raw
}

function userImages(m: UserMsg) {
  if (typeof m.content === "string") return []
  return m.content.filter((c) => c.type === "image") as { data: string; mimeType: string }[]
}

/** Taller than this and a message folds, showing a fade and "Show more". */
const FOLD_PX = 240
/** Folding is skipped when it would hide less than this: a button to reveal two lines isn't worth it. */
const FOLD_SLACK_PX = 32

function Foldable({ children }: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // scrollHeight is the natural height whether or not the fold is applied, so this can't flip back and forth
    const measure = () => setTall(el.scrollHeight > FOLD_PX + FOLD_SLACK_PX)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const folded = tall && !open
  return (
    <>
      <div ref={ref} className={cn("relative", folded && "overflow-hidden")} style={folded ? { maxHeight: FOLD_PX } : undefined}>
        {children}
        {folded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-muted to-transparent" />}
      </div>
      {tall && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-10"
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          {open ? t("msg.showLess") : t("msg.showMore")}
        </button>
      )}
    </>
  )
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
      {m.files && m.files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {m.files.map((f, i) => (
            <div key={i} className="flex max-w-64 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
            </div>
          ))}
        </div>
      )}
      {text && (
        <div
          className={cn(
            "max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[0.875rem] leading-relaxed whitespace-pre-wrap break-words select-text",
            isCommand && "font-mono text-[13px]",
          )}
        >
          <Foldable>{text}</Foldable>
        </div>
      )}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 pointer-coarse:opacity-100">
        <span className="mr-1 text-[11px] text-muted-foreground">{clockTime(m.timestamp)}</span>
        <CopyButton text={text} />
        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t("msg.editResend")} onClick={() => onEdit(stored.seq, text)}>
                <PencilIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("msg.editResend")}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t("msg.fork")} onClick={() => onFork(stored.seq)}>
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

export function Thinking({ text, streaming, defaultOpen = false }: { text: string; streaming: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const firstLine = text.trim().split("\n").filter(Boolean).pop()?.slice(0, 120) ?? ""
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-[13px] text-muted-foreground hover:text-foreground pointer-coarse:min-h-10">
          <BrainIcon className="size-3.5 shrink-0" />
          <span className={cn("shrink-0", streaming && "text-shimmer")}>{streaming ? t("msg.thinking") : t("msg.thoughts")}</span>
          {!open && streaming && <span className="truncate text-xs opacity-70">{firstLine}</span>}
          <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-1.5 border-l-2 pl-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground select-text">{text}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Totals for everything the agent did between the user's message and this reply. */
export interface TurnStats {
  calls: number
  tools: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface ReplyMeta {
  msg: AssistantMsg
  seq: number
  turn: TurnStats
}

export function AssistantMeta({ meta, hover, onFork }: { meta: ReplyMeta; hover?: boolean; onFork?: (seq: number) => void }) {
  const [open, setOpen] = useState(false)
  const text = meta.msg.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n\n")
  return (
    <div className={cn("mt-1 flex items-center gap-0.5", hover && !open && "opacity-0 transition-opacity group-hover/assistant:opacity-100 pointer-coarse:opacity-100")}>
      <CopyButton text={text} />
      {onFork && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t("msg.fork")} onClick={() => onFork(meta.seq)}>
              <GitBranchIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("msg.fork")}</TooltipContent>
        </Tooltip>
      )}
      <Panel
        open={open}
        onOpenChange={setOpen}
        popoverClassName="w-80 p-0"
        sheetClassName="p-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        trigger={
          <Button variant="ghost" size="icon-xs" aria-label={t("meta.details")} title={t("meta.details")}>
            <InfoIcon />
          </Button>
        }
      >
        <ReplyDetails meta={meta} />
      </Panel>
      <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">{clockTime(meta.msg.timestamp)}</span>
    </div>
  )
}

function Stat({ label, value, sub, swatch, strong }: { label: string; value: string; sub?: string; swatch?: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline gap-2 py-0.5", strong && "font-medium text-foreground")}>
      {swatch && <span className="size-2 shrink-0 translate-y-[-1px] rounded-[2px]" style={{ background: swatch }} />}
      <span className={cn("min-w-0 flex-1 truncate", !strong && "text-muted-foreground")}>{label}</span>
      {sub && <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>}
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/** The reply's model, tokens by kind with what each cost, and, when the agent took several steps, the turn's totals. */
function ReplyDetails({ meta }: { meta: ReplyMeta }) {
  const { msg, turn } = meta
  const u = msg.usage
  const name = findModel(msg.provider, msg.model)?.name ?? msg.model
  const parts = [
    { key: "input", value: u.input, cost: u.cost.input, color: "var(--ctx-1)" },
    { key: "cacheRead", value: u.cacheRead, cost: u.cost.cacheRead, color: "var(--ctx-3)" },
    { key: "cacheWrite", value: u.cacheWrite, cost: u.cost.cacheWrite, color: "var(--ctx-4)" },
    { key: "output", value: u.output, cost: u.cost.output, color: "var(--ctx-2)" },
  ].filter((p) => p.value > 0)
  const total = parts.reduce((n, p) => n + p.value, 0)
  const prompt = u.input + u.cacheRead + u.cacheWrite
  const money = (n: number) => (n > 0 ? formatCost(n) : undefined)
  const turnTokens = turn.input + turn.output + turn.cacheRead + turn.cacheWrite
  return (
    <div className="grid gap-3 p-3 text-sm pointer-coarse:p-4 pointer-coarse:text-base">
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {providerName(msg.provider)} · {new Date(msg.timestamp).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" })}
        </div>
        {msg.stopReason === "length" && <div className="mt-1 text-xs text-warning">{t("meta.truncated")}</div>}
      </div>
      {total > 0 && (
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">{t("meta.thisReply")}</div>
          <div className="flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
            {parts.map((p) => (
              <div key={p.key} style={{ flexGrow: p.value, background: p.color }} />
            ))}
          </div>
          <div className="grid text-[13px] pointer-coarse:text-sm">
            {parts.map((p) => (
              <Stat
                key={p.key}
                swatch={p.color}
                label={t(`meta.${p.key}` as MessageKey)}
                sub={p.key === "cacheRead" && prompt ? t("meta.hitRate", { n: Math.round((u.cacheRead / prompt) * 100) }) : money(p.cost)}
                value={formatTokens(p.value)}
              />
            ))}
            <div className="mt-1 border-t pt-1">
              <Stat strong label={t("meta.total")} sub={formatTokens(total)} value={formatCost(u.cost.total)} />
            </div>
          </div>
        </div>
      )}
      {turn.calls > 1 && (
        <div className="grid gap-1 border-t pt-3">
          <div className="text-xs font-medium text-muted-foreground">{t("meta.wholeTurn")}</div>
          <div className="grid text-[13px] pointer-coarse:text-sm">
            <Stat label={t("meta.modelCalls")} value={String(turn.calls)} />
            <Stat label={t("meta.toolCalls")} value={String(turn.tools)} />
            <Stat label={t("meta.tokens")} value={formatTokens(turnTokens)} />
            <Stat strong label={t("meta.total")} value={formatCost(turn.cost)} />
          </div>
        </div>
      )}
    </div>
  )
}

/** A session merged into this one: one quiet line in the transcript, the summary the model received on click. */
export function MergeNote({ merge }: { merge: NonNullable<UserMsg["merge"]> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted pointer-coarse:min-h-9">
          <GitMergeIcon className="size-3 shrink-0" />
          <span className="truncate">{t("msg.merged", { title: merge.title, n: merge.messages })}</span>
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("msg.mergedTitle", { title: merge.title })}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-2">
            <Markdown text={merge.summary} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CompactionDivider({ c }: { c: CompactionInfo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted pointer-coarse:min-h-9">
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
        <div className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground select-text">{message}</div>
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
