// Usage: cost, tokens, cache hits and tool calls over a chosen range, by day, model, tool and hour, and the
// most expensive sessions.
import { useCallback, useEffect, useMemo, useState } from "preact/hooks"
import { ActivityIcon, CoinsIcon, DatabaseZapIcon, MessagesSquareIcon, WrenchIcon, ZapIcon } from "lucide-react"
import type { UsageSummary } from "@shared/protocol"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PageHeader } from "@/components/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { EChart, type VizTheme } from "@/components/echart"
import { dailyOption, dailySeries, heatOption, modelOption, toolOption } from "@/components/usage/charts"
import { ChartCard, Kpi } from "@/components/usage/parts"
import { rpc } from "@/lib/api"
import { formatCost, formatTokens, relativeTime } from "@/lib/format"
import { openSession } from "@/lib/store"
import { cn } from "@/lib/utils"
import { lang, t as tr } from "@/lib/i18n"

const RANGES = [
  { value: "7", key: "usage.d7" },
  { value: "30", key: "usage.d30" },
  { value: "90", key: "usage.d90" },
  { value: "0", key: "usage.all" },
] as const

export function UsagePage() {
  const [range, setRange] = useState("30")
  const [data, setData] = useState<UsageSummary | null>(null)

  useEffect(() => {
    setData(null)
    rpc<UsageSummary>("usage.summary", { days: Number(range) }).then(setData)
  }, [range])

  const daily = useMemo(() => (data ? dailySeries(data, Number(range)) : null), [data, range, lang.value])

  const dailyChart = useCallback((t: VizTheme) => dailyOption(t, daily), [daily])
  const modelChart = useCallback((t: VizTheme) => modelOption(t, data), [data, lang.value])
  const toolChart = useCallback((t: VizTheme) => toolOption(t, data), [data, lang.value])
  const heatChart = useCallback((t: VizTheme) => heatOption(t, data), [data, lang.value])

  const rangePicker = (className: string, segmented = false) => (
    <ToggleGroup type="single" variant="outline" size="sm" spacing={segmented ? 0 : undefined} value={range} onValueChange={(v) => v && setRange(v)} className={className}>
      {RANGES.map((r) => (
        <ToggleGroupItem key={r.value} value={r.value} className={cn("px-3 text-xs", segmented && "flex-1")}>
          {tr(r.key)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )

  const tot = data?.totals
  const cacheRate = tot && tot.input + tot.cacheRead > 0 ? tot.cacheRead / (tot.input + tot.cacheRead + tot.cacheWrite) : 0

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <span className="text-sm font-medium">{tr("usage.title")}</span>
        {rangePicker("ml-auto max-sm:hidden")}
      </PageHeader>
      {/* Phones: a full-width segmented control under the header, as in native apps. */}
      <div className="border-b px-4 py-2 sm:hidden">
        {rangePicker("w-full", true)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-4 p-4 pb-[max(1rem,var(--safe-bottom))] md:p-6">
          {!data ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-80 rounded-xl" />
            </div>
          ) : tot!.requests === 0 ? (
            <Empty className="mt-20">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>{tr("usage.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{tr("usage.emptyDesc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <Kpi icon={CoinsIcon} label={tr("usage.cost")} value={formatCost(tot!.cost)} sub={tr("usage.costSub")} />
                <Kpi icon={ZapIcon} label="Tokens" value={formatTokens(tot!.input + tot!.output + tot!.cacheRead + tot!.cacheWrite)} sub={tr("usage.outputN", { n: formatTokens(tot!.output) })} />
                <Kpi icon={DatabaseZapIcon} label={tr("usage.cacheHit")} value={`${Math.round(cacheRate * 100)}%`} sub={tr("usage.readN", { n: formatTokens(tot!.cacheRead) })} />
                <Kpi icon={ActivityIcon} label={tr("usage.requests")} value={String(tot!.requests)} />
                <Kpi icon={MessagesSquareIcon} label={tr("usage.sessions")} value={String(tot!.sessions)} />
                <Kpi
                  icon={WrenchIcon}
                  label={tr("usage.toolCalls")}
                  value={String(tot!.toolCalls)}
                  sub={tot!.toolCalls ? tr("usage.failRate", { pct: ((tot!.toolErrors / tot!.toolCalls) * 100).toFixed(1) }) : undefined}
                />
              </div>
              <ChartCard title={tr("usage.daily")} desc={tr("usage.dailyDesc")}>
                <EChart option={dailyChart} height={300} />
              </ChartCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={tr("usage.byModel")} desc={tr("usage.byModelDesc")}>
                  <EChart option={modelChart} height={Math.max(160, Math.min(8, data.byModel.length) * 34 + 20)} />
                </ChartCard>
                <ChartCard title={tr("usage.byTool")} desc={tr("usage.byToolDesc")}>
                  <EChart option={toolChart} height={Math.max(160, Math.min(10, data.byTool.length) * 28 + 40)} />
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-5">
                <ChartCard title={tr("usage.activity")} desc={tr("usage.activityDesc")} className="lg:col-span-3">
                  <EChart option={heatChart} height={250} />
                </ChartCard>
                <ChartCard title={tr("usage.topSessions")} className="lg:col-span-2">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("usage.session")}</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">{tr("usage.cost")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topSessions.map((s) => (
                        <TableRow key={s.id} className="cursor-pointer" onClick={() => openSession(s.id)}>
                          <TableCell className="max-w-[9rem]">
                            <div className="truncate">{s.title || tr("common.untitled")}</div>
                            <div className="text-[11px] text-muted-foreground">{relativeTime(s.updatedAt)}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatTokens(s.tokens)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCost(s.cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ChartCard>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
