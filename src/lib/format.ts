import { locale, t } from "./i18n"

export function formatTokens(n: number): string {
  if (!n) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

export function formatCost(n: number): string {
  if (!n) return "$0"
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`
  const m = Math.floor(s / 60)
  return `${m}m${Math.round(s % 60)}s`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t("time.justNow")
  if (diff < 3600_000) return t("time.minutesAgo", { n: Math.floor(diff / 60_000) })
  if (diff < 86400_000) return t("time.hoursAgo", { n: Math.floor(diff / 3600_000) })
  if (diff < 7 * 86400_000) return t("time.daysAgo", { n: Math.floor(diff / 86400_000) })
  return new Date(ts).toLocaleDateString(locale(), { month: "short", day: "numeric" })
}

export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
}

export function shortPath(p: string, home?: string): string {
  if (home && p.startsWith(home)) return "~" + p.slice(home.length)
  return p
}

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/")
  return parts[parts.length - 1] || p
}

export function dayBucket(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const diff = (today.getTime() - day.getTime()) / 86400_000
  if (diff <= 0) return t("time.today")
  if (diff <= 1) return t("time.yesterday")
  if (diff <= 7) return t("time.last7")
  if (diff <= 30) return t("time.last30")
  return t("time.older")
}
