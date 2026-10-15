import { useEffect, useRef } from "preact/hooks"
import * as echarts from "echarts/core"
import { BarChart, HeatmapChart, LineChart } from "echarts/charts"
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import { settings } from "@/lib/store"

echarts.use([BarChart, HeatmapChart, LineChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
}

export function vizTheme() {
  const dark = document.documentElement.classList.contains("dark")
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  return {
    dark,
    series: dark ? SERIES.dark : SERIES.light,
    surface: v("--card"),
    text: v("--foreground"),
    muted: v("--muted-foreground"),
    border: v("--border"),
    critical: dark ? "#e66767" : "#d03b3b",
    sequential: dark ? ["#1d2a3a", "#1f4f8a", "#3987e5", "#9cc6f5"] : ["#eef4fc", "#a9cbf2", "#2a78d6", "#123e78"],
  }
}

export type VizTheme = ReturnType<typeof vizTheme>

export function EChart({ option, height = 280 }: { option: (t: VizTheme) => echarts.EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const themeKey = `${settings.value?.theme}-${settings.value?.accent}`

  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    const mo = new MutationObserver(() => c.setOption(option(vizTheme()), true))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      ro.disconnect()
      mo.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option(vizTheme()), true)
  }, [option, themeKey])

  return <div ref={ref} style={{ height }} className="w-full" />
}

export function baseOption(t: VizTheme) {
  return {
    color: t.series,
    textStyle: { fontFamily: "inherit", color: t.muted, fontSize: 11 },
    animationDuration: 400,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);",
    },
  }
}
