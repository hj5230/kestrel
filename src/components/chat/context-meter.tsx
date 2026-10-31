// The context window as a ring in the header; a click opens where the window goes, part by part.
// Parts are estimates from the sidecar; the total is the provider's own count once a reply has come back.
import { useEffect, useState } from "preact/hooks"
import { ShrinkIcon } from "lucide-react"
import type { ContextBreakdown, ModelConfig, SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { rpc } from "@/lib/api"
import { formatCost, formatTokens } from "@/lib/format"
import { settings } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"
import { Panel } from "./pickers"

function Ring({ value }: { value: number }) {
  const r = 7
  const c = 2 * Math.PI * r
  const v = Math.min(1, Math.max(0, value))
  return (
    <svg viewBox="0 0 18 18" className="size-4 -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray={c} strokeDashoffset={c * (1 - v)} strokeLinecap="round" />
    </svg>
  )
}

/** Fixed order and colors: a part keeps its color whatever the others measure. */
const PARTS: { key: keyof ContextBreakdown["parts"]; color: string }[] = [
  { key: "messages", color: "var(--ctx-1)" },
  { key: "mcp", color: "var(--ctx-2)" },
  { key: "skills", color: "var(--ctx-3)" },
  { key: "tools", color: "var(--ctx-4)" },
  { key: "instructions", color: "var(--ctx-5)" },
  { key: "system", color: "var(--muted-foreground)" },
]

const pct = (n: number, of: number) => `${of ? ((n / of) * 100).toFixed(1) : "0.0"}%`

/** Header cost: always two decimals; the panel shows the exact figure. */
const shortCost = (n: number) => `$${n.toFixed(2)}`

function Breakdown({ b, used, window }: { b: ContextBreakdown | null; used: number; window: number }) {
  // Estimates rarely add up to the reported total; scale them to it so the bar and the rows agree.
  const raw = b ? PARTS.reduce((n, p) => n + b.parts[p.key], 0) : 0
  const scale = raw > 0 ? used / raw : 0
  const rows = PARTS.map((p) => ({ ...p, n: b ? Math.round(b.parts[p.key] * scale) : 0 })).filter((r) => r.n > 0)
  const buffer = Math.min(b?.buffer ?? 0, Math.max(0, window - used))
  const free = Math.max(0, window - used - buffer)
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between text-sm font-medium">
        {t("ctx.used", { pct: Math.round((used / window) * 100) })}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {formatTokens(used)} / {formatTokens(window)}
        </span>
      </div>
      {/* 2px surface gaps between segments; the track behind them is free space. */}
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={t("ctx.window")}>
        {rows.map((r) => (
          <span key={r.key} className="h-full shrink-0 first:rounded-l-full" style={{ width: `${(r.n / window) * 100}%`, minWidth: 2, background: r.color }} />
        ))}
        {buffer > 0 && <span className="ml-auto h-full shrink-0 rounded-r-full bg-muted-foreground/30" style={{ width: `${(buffer / window) * 100}%` }} />}
      </div>
      {!b ? (
        <div className="h-24" />
      ) : (
        <ul className="grid gap-1 text-xs">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate">{t(`ctx.part.${r.key}` as MessageKey)}</span>
              <span className="w-12 text-right text-muted-foreground tabular-nums">{formatTokens(r.n)}</span>
              <span className="w-11 text-right tabular-nums">{pct(r.n, window)}</span>
            </li>
          ))}
          {buffer > 0 && (
            <li className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[3px] bg-muted-foreground/30" />
              <span className="min-w-0 flex-1 truncate">{t("ctx.part.buffer")}</span>
              <span className="w-12 text-right text-muted-foreground tabular-nums">{formatTokens(buffer)}</span>
              <span className="w-11 text-right tabular-nums">{pct(buffer, window)}</span>
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px] border bg-muted" />
            <span className="min-w-0 flex-1 truncate">{t("ctx.part.free")}</span>
            <span className="w-12 text-right text-muted-foreground tabular-nums">{formatTokens(free)}</span>
            <span className="w-11 text-right tabular-nums">{pct(free, window)}</span>
          </li>
        </ul>
      )}
      {b && (
        <div className="text-[11px] text-muted-foreground">
          {t("ctx.counts", { mcp: b.counts.mcpTools, skills: b.counts.skills, files: b.counts.instructionFiles })}
        </div>
      )}
    </div>
  )
}

export function ContextMeter({ session, model, onCompact, compacting }: { session: SessionInfo; model?: ModelConfig; onCompact: () => void; compacting: boolean }) {
  const [open, setOpen] = useState(false)
  const [b, setB] = useState<ContextBreakdown | null>(null)
  const window = model?.contextWindow ?? b?.window ?? 128000
  const u = session.usage
  const used = u.contextTokens || b?.used || 0
  const ratio = used / window
  const threshold = settings.value?.compactThreshold ?? 0.8
  const tone = ratio > threshold ? "text-destructive" : ratio > threshold * 0.75 ? "text-warning" : "text-muted-foreground"

  useEffect(() => {
    if (!open) return
    let live = true
    rpc<ContextBreakdown>("sessions.contextBreakdown", { id: session.id })
      .then((r) => live && setB(r))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [open, session.id, u.contextTokens])

  const rows: [string, string][] = [
    [t("ctx.input"), formatTokens(u.input)],
    [t("ctx.output"), formatTokens(u.output)],
    [t("ctx.cacheRead"), formatTokens(u.cacheRead)],
    [t("ctx.cacheWrite"), formatTokens(u.cacheWrite)],
  ]
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      align="end"
      popoverClassName="w-80 p-4"
      sheetClassName="px-4 pt-4 pb-[max(1rem,var(--inset-bottom))]"
      trigger={
        <button
          type="button"
          aria-label={t("ctx.window")}
          className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs whitespace-nowrap tabular-nums hover:bg-muted aria-expanded:bg-muted pointer-coarse:min-h-10", tone)}
        >
          <Ring value={ratio} />
          <span>{Math.round(ratio * 100)}%</span>
          {u.cost > 0 && <span className="text-muted-foreground max-sm:hidden">· {shortCost(u.cost)}</span>}
        </button>
      }
    >
      <div className="grid gap-3">
        <Breakdown b={b} used={used} window={window} />
        <div className="text-xs text-muted-foreground">
          {settings.value?.autoCompact ? t("ctx.autoAt", { pct: Math.round(threshold * 100) }) : t("ctx.autoOff")}
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="text-muted-foreground">{k}</span>
              <span className="tabular-nums">{v}</span>
            </div>
          ))}
          <div className="col-span-2 mt-1 flex justify-between border-t pt-1.5">
            <span className="text-muted-foreground">{t("ctx.cost")}</span>
            <span className="font-medium tabular-nums">{formatCost(u.cost)}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false)
            onCompact()
          }}
          disabled={compacting || session.status === "running"}
        >
          <ShrinkIcon />
          {compacting ? t("ctx.compacting") : t("ctx.compact")}
        </Button>
      </div>
    </Panel>
  )
}
