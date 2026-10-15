import { useCallback, useEffect, useMemo, useState } from "preact/hooks"
import { ActivityIcon, CoinsIcon, DatabaseZapIcon, MessagesSquareIcon, WrenchIcon, ZapIcon } from "lucide-react"
import type { UsageSummary } from "@shared/protocol"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { EChart, baseOption, type VizTheme } from "@/components/echart"
import { rpc } from "@/lib/api"
import { formatCost, formatDuration, formatTokens, relativeTime } from "@/lib/format"
import { openSession } from "@/lib/store"
import { cn } from "@/lib/utils"

const RANGES = [
  { value: "7", label: "7 天" },
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
  { value: "0", label: "全部" },
]
const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

function Kpi({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function ChartCard({ title, desc, children, className }: { title: string; desc?: string; children: any; className?: string }) {
  return (
    <Card className={cn("gap-2", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {desc && <CardDescription className="text-xs">{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
    </Card>
  )
}

function days(range: number, data: UsageSummary["daily"]) {
  const out: string[] = []
  const n = range || Math.max(7, Math.ceil((Date.now() - new Date(data[0]?.day ?? Date.now()).getTime()) / 86400_000) + 1)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
  }
  return out
}

export function UsagePage() {
  const [range, setRange] = useState("30")
  const [data, setData] = useState<UsageSummary | null>(null)
  const { state: sidebarState } = useSidebar()

  useEffect(() => {
    setData(null)
    rpc<UsageSummary>("usage.summary", { days: Number(range) }).then(setData)
  }, [range])

  const daily = useMemo(() => {
    if (!data) return null
    const top = data.byModel.slice(0, 7).map((m) => m.model)
    const models = [...top, ...(data.byModel.length > 7 ? ["其他"] : [])]
    const axis = days(Number(range), data.daily)
    const series = models.map((m) => ({ name: m, values: axis.map(() => 0) }))
    for (const row of data.daily) {
      const i = axis.indexOf(row.day)
      if (i < 0) continue
      const name = top.includes(row.model) ? row.model : "其他"
      const s = series.find((x) => x.name === name)
      if (s) s.values[i] += row.tokens
    }
    return { axis, series }
  }, [data, range])

  const dailyOption = useCallback(
    (t: VizTheme) => ({
      ...baseOption(t),
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
      tooltip: {
        ...baseOption(t).tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: t.dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.04)" } },
        valueFormatter: (v: number) => formatTokens(v),
      },
      xAxis: {
        type: "category",
        data: daily?.axis.map((d) => d.slice(5)) ?? [],
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: t.border, type: [3, 3] } },
        axisLabel: { color: t.muted, formatter: (v: number) => formatTokens(v) },
      },
      series: (daily?.series ?? []).map((s, i, arr) => ({
        name: s.name,
        type: "bar",
        stack: "tokens",
        barMaxWidth: 22,
        data: s.values,
        itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: i === arr.length - 1 ? [4, 4, 0, 0] : 0 },
        emphasis: { focus: "series" },
      })),
    }),
    [daily],
  )

  const modelOption = useCallback(
    (t: VizTheme) => {
      const rows = (data?.byModel ?? []).slice(0, 8).reverse()
      return {
        ...baseOption(t),
        grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "item",
          formatter: (p: any) => {
            const r = rows[p.dataIndex]
            return `<b>${r.model}</b><br/>${r.provider}<br/>${formatTokens(r.tokens)} tokens · ${r.requests} 次请求<br/>${formatCost(r.cost)}`
          },
        },
        xAxis: { type: "value", show: false },
        yAxis: {
          type: "category",
          data: rows.map((r) => r.model),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.text, width: 150, overflow: "truncate" },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 14,
            data: rows.map((r) => r.tokens),
            itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right", color: t.muted, formatter: (p: any) => formatTokens(p.value) },
          },
        ],
      }
    },
    [data],
  )

  const toolOption = useCallback(
    (t: VizTheme) => {
      const rows = (data?.byTool ?? []).slice(0, 10).reverse()
      return {
        ...baseOption(t),
        grid: { left: 8, right: 40, top: 28, bottom: 4, containLabel: true },
        legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: t.muted, fontSize: 11 } },
        tooltip: {
          ...baseOption(t).tooltip,
          trigger: "axis",
          axisPointer: { type: "none" },
          formatter: (ps: any[]) => {
            const r = rows[ps[0].dataIndex]
            return `<b>${r.tool}</b><br/>${r.count} 次 · 失败 ${r.errors} 次<br/>平均耗时 ${formatDuration(r.avgMs)}`
          },
        },
        xAxis: { type: "value", show: false },
        yAxis: {
          type: "category",
          data: rows.map((r) => r.tool),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.text, fontFamily: "monospace" },
        },
        series: [
          { name: "成功", type: "bar", stack: "t", barMaxWidth: 14, data: rows.map((r) => r.count - r.errors), itemStyle: { color: t.series[2], borderColor: t.surface, borderWidth: 1 } },
          {
            name: "失败",
            type: "bar",
            stack: "t",
            barMaxWidth: 14,
            data: rows.map((r) => r.errors),
            itemStyle: { color: t.critical, borderColor: t.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: "right", color: t.muted, formatter: (p: any) => String(rows[p.dataIndex].count) },
          },
        ],
      }
    },
    [data],
  )

  const heatOption = useCallback(
    (t: VizTheme) => {
      const cells = (data?.byHour ?? []).map((c) => [c.hour, (c.weekday + 6) % 7, c.count])
      const max = Math.max(1, ...cells.map((c) => c[2]))
      return {
        ...baseOption(t),
        grid: { left: 8, right: 8, top: 4, bottom: 40, containLabel: true },
        tooltip: {
          ...baseOption(t).tooltip,
          formatter: (p: any) => `${WEEK[(p.value[1] + 1) % 7]} ${p.value[0]}:00<br/>${p.value[2]} 次请求`,
        },
        xAxis: {
          type: "category",
          data: Array.from({ length: 24 }, (_, i) => String(i)),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.muted, interval: 2 },
          splitArea: { show: false },
        },
        yAxis: {
          type: "category",
          data: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
          inverse: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.muted },
        },
        visualMap: {
          min: 0,
          max,
          orient: "horizontal",
          left: "center",
          bottom: 0,
          itemHeight: 120,
          itemWidth: 10,
          calculable: false,
          textStyle: { color: t.muted },
          inRange: { color: t.sequential },
        },
        series: [{ type: "heatmap", data: cells, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 } }],
      }
    },
    [data],
  )

  const tot = data?.totals
  const cacheRate = tot && tot.input + tot.cacheRead > 0 ? tot.cacheRead / (tot.input + tot.cacheRead + tot.cacheWrite) : 0

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className={cn("drag-region flex h-12 shrink-0 items-center gap-2 border-b px-3", sidebarState === "collapsed" && "pl-20")}>
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">用量统计</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v)} className="ml-auto">
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} className="px-3 text-xs">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-4 p-6">
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
                <EmptyTitle>这段时间还没有用量</EmptyTitle>
                <EmptyDescription>开始一次对话后，这里会展示 token、费用、模型与工具的使用情况。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                <Kpi icon={CoinsIcon} label="费用" value={formatCost(tot!.cost)} sub="按模型单价估算" />
                <Kpi icon={ZapIcon} label="Tokens" value={formatTokens(tot!.input + tot!.output + tot!.cacheRead + tot!.cacheWrite)} sub={`输出 ${formatTokens(tot!.output)}`} />
                <Kpi icon={DatabaseZapIcon} label="缓存命中" value={`${Math.round(cacheRate * 100)}%`} sub={`读取 ${formatTokens(tot!.cacheRead)}`} />
                <Kpi icon={ActivityIcon} label="模型请求" value={String(tot!.requests)} />
                <Kpi icon={MessagesSquareIcon} label="活跃会话" value={String(tot!.sessions)} />
                <Kpi
                  icon={WrenchIcon}
                  label="工具调用"
                  value={String(tot!.toolCalls)}
                  sub={tot!.toolCalls ? `失败率 ${((tot!.toolErrors / tot!.toolCalls) * 100).toFixed(1)}%` : undefined}
                />
              </div>
              <ChartCard title="每日 Token 用量" desc="按模型堆叠">
                <EChart option={dailyOption} height={300} />
              </ChartCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="模型用量排行" desc="按 token 总量">
                  <EChart option={modelOption} height={Math.max(160, Math.min(8, data.byModel.length) * 34 + 20)} />
                </ChartCard>
                <ChartCard title="工具调用" desc="调用次数与失败次数">
                  <EChart option={toolOption} height={Math.max(160, Math.min(10, data.byTool.length) * 28 + 40)} />
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-5">
                <ChartCard title="活跃时段" desc="模型请求次数（本地时间）" className="lg:col-span-3">
                  <EChart option={heatOption} height={250} />
                </ChartCard>
                <ChartCard title="消耗最多的会话" className="lg:col-span-2">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>会话</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">费用</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topSessions.map((s) => (
                        <TableRow key={s.id} className="cursor-pointer" onClick={() => openSession(s.id)}>
                          <TableCell className="max-w-[9rem]">
                            <div className="truncate">{s.title || "新会话"}</div>
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
