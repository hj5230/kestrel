// The usage page's charts as ECharts options, built from the summary and the current theme. Pure, so the page
// only decides when to rebuild them.
import type { UsageSummary } from "@shared/protocol"
import { baseOption, type VizTheme } from "@/components/echart"
import { formatCost, formatDuration, formatTokens } from "@/lib/format"
import { locale, t as tr } from "@/lib/i18n"

export type DailySeries = ReturnType<typeof dailySeries>

export function weekdays(style: "short" | "long" = "short") {
  const base = new Date(2024, 0, 7)
  return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86400_000).toLocaleDateString(locale(), { weekday: style }))
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

/** Tokens per day, stacked by the seven busiest models and the rest. */
export function dailySeries(data: UsageSummary, range: number) {
  const top = data.byModel.slice(0, 7).map((m) => m.model)
  const other = tr("usage.other")
  const models = [...top, ...(data.byModel.length > 7 ? [other] : [])]
  const axis = days(range, data.daily)
  const series = models.map((m) => ({ name: m, values: axis.map(() => 0) }))
  for (const row of data.daily) {
    const i = axis.indexOf(row.day)
    if (i < 0) continue
    const name = top.includes(row.model) ? row.model : other
    const s = series.find((x) => x.name === name)
    if (s) s.values[i] += row.tokens
  }
  return { axis, series }
}

export function dailyOption(t: VizTheme, daily: DailySeries | null) {
  return {
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
  }
}

export function modelOption(t: VizTheme, data: UsageSummary | null) {
  const rows = (data?.byModel ?? []).slice(0, 8).reverse()
  return {
    ...baseOption(t),
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...baseOption(t).tooltip,
      trigger: "item",
      formatter: (p: any) => {
        const r = rows[p.dataIndex]
        return `<b>${r.model}</b><br/>${r.provider}<br/>${formatTokens(r.tokens)} tokens · ${tr("usage.requestsN", { n: r.requests })}<br/>${formatCost(r.cost)}`
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
}

export function toolOption(t: VizTheme, data: UsageSummary | null) {
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
        return `<b>${r.tool}</b><br/>${tr("usage.toolTip", { count: r.count, errors: r.errors, avg: formatDuration(r.avgMs) })}`
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
      { name: tr("usage.success"), type: "bar", stack: "t", barMaxWidth: 14, data: rows.map((r) => r.count - r.errors), itemStyle: { color: t.series[2], borderColor: t.surface, borderWidth: 1 } },
      {
        name: tr("usage.failed"),
        type: "bar",
        stack: "t",
        barMaxWidth: 14,
        data: rows.map((r) => r.errors),
        itemStyle: { color: t.critical, borderColor: t.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.muted, formatter: (p: any) => String(rows[p.dataIndex].count) },
      },
    ],
  }
}

export function heatOption(t: VizTheme, data: UsageSummary | null) {
  const cells = (data?.byHour ?? []).map((c) => [c.hour, (c.weekday + 6) % 7, c.count])
  const max = Math.max(1, ...cells.map((c) => c[2]))
  return {
    ...baseOption(t),
    grid: { left: 8, right: 8, top: 4, bottom: 40, containLabel: true },
    tooltip: {
      ...baseOption(t).tooltip,
      formatter: (p: any) => `${weekdays("long")[(p.value[1] + 1) % 7]} ${p.value[0]}:00<br/>${tr("usage.requestsN", { n: p.value[2] })}`,
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
      data: [...weekdays().slice(1), weekdays()[0]],
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
}
