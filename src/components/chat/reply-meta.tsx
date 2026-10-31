// The line under an agent reply (copy, fork, details) and the details panel: model, tokens by kind with what
// each cost, and the whole turn's totals when the agent took several steps.
import { useState } from "preact/hooks"
import { GitBranchIcon, InfoIcon } from "lucide-react"
import type { AssistantMsg } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Panel } from "./pickers"
import { formatCost, formatTokens, clockTime } from "@/lib/format"
import { findModel, providerName } from "@/lib/store"
import { cn } from "@/lib/utils"
import { locale, t, type MessageKey } from "@/lib/i18n"
import { CopyButton } from "./messages"

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
        sheetClassName="p-0 pb-[max(0.5rem,var(--inset-bottom))]"
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

export function Stat({ label, value, sub, swatch, strong }: { label: string; value: string; sub?: string; swatch?: string; strong?: boolean }) {
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
export function ReplyDetails({ meta }: { meta: ReplyMeta }) {
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
