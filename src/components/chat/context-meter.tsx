import { ShrinkIcon } from "lucide-react"
import type { ModelConfig, SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { formatCost, formatTokens } from "@/lib/format"
import { settings } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

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

export function ContextMeter({ session, model, onCompact, compacting }: { session: SessionInfo; model?: ModelConfig; onCompact: () => void; compacting: boolean }) {
  const window = model?.contextWindow ?? 128000
  const used = session.usage.contextTokens
  const ratio = used / window
  const threshold = settings.value?.compactThreshold ?? 0.8
  const tone = ratio > threshold ? "text-destructive" : ratio > threshold * 0.75 ? "text-warning" : "text-muted-foreground"
  const u = session.usage
  const rows: [string, string][] = [
    [t("ctx.input"), formatTokens(u.input)],
    [t("ctx.output"), formatTokens(u.output)],
    [t("ctx.cacheRead"), formatTokens(u.cacheRead)],
    [t("ctx.cacheWrite"), formatTokens(u.cacheWrite)],
  ]
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <button type="button" className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs whitespace-nowrap tabular-nums hover:bg-muted pointer-coarse:min-h-10", tone)}>
          <Ring value={ratio} />
          <span>{Math.round(ratio * 100)}%</span>
          {u.cost > 0 && <span className="text-muted-foreground max-sm:hidden">· {formatCost(u.cost)}</span>}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72">
        <div className="grid gap-3">
          <div>
            <div className="flex items-baseline justify-between text-sm font-medium">
              {t("ctx.window")}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {formatTokens(used)} / {formatTokens(window)}
              </span>
            </div>
            <Progress value={Math.min(100, ratio * 100)} className="mt-2 h-1.5" />
            <div className="mt-1.5 text-xs text-muted-foreground">
              {settings.value?.autoCompact ? t("ctx.autoAt", { pct: Math.round(threshold * 100) }) : t("ctx.autoOff")}
            </div>
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
          <Button variant="outline" size="sm" onClick={onCompact} disabled={compacting || session.status === "running"}>
            <ShrinkIcon />
            {compacting ? t("ctx.compacting") : t("ctx.compact")}
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
