// The log viewer: the newest records of one tier, filtered by level, area and text.
import { useEffect, useState } from "preact/hooks"
import type { LogLevel, LogPage, LogRecord } from "@shared/protocol"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { logQuery } from "@/lib/log-view"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const LEVEL_CLASS: Record<LogLevel, string> = { debug: "text-muted-foreground", info: "text-foreground", warn: "text-amber-600 dark:text-amber-400", error: "text-destructive" }

function Line({ r }: { r: LogRecord }) {
  const fields = r.fields ? JSON.stringify(r.fields) : ""
  return (
    <div className="border-b px-3 py-1.5 font-mono text-[11px] leading-relaxed break-all select-text">
      <span className="text-muted-foreground">{r.time.slice(5, 23).replace("T", " ")} </span>
      <span className={cn("font-semibold uppercase", LEVEL_CLASS[r.level])}>{r.level} </span>
      <span className="text-muted-foreground">{r.src}/{r.mod} </span>
      <span>{r.msg}</span>
      {fields && <div className="text-muted-foreground">{fields}</div>}
    </div>
  )
}

export function LogsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [tier, setTier] = useState<"important" | "routine">("important")
  const [minLevel, setMinLevel] = useState<LogLevel>("warn")
  const [module, setModule] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState<LogPage | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      logQuery({ tier, minLevel, module: module || undefined, search: search.trim() || undefined, limit: 300 })
        .then((p) => { setPage(p); setError("") })
        .catch((e) => setError(String(e?.message ?? e)))
    }, 200)
    return () => clearTimeout(timer)
  }, [open, tier, minLevel, module, search])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-3xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t("log.viewerTitle")}</DialogTitle>
          <DialogDescription>{t("log.viewerDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={tier} onValueChange={(v) => v && (setTier(v as typeof tier), setMinLevel(v === "important" ? "warn" : "info"))}>
            <ToggleGroupItem value="important">{t("log.tierImportant")}</ToggleGroupItem>
            <ToggleGroupItem value="routine">{t("log.tierRoutine")}</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={minLevel} onValueChange={(v) => v && setMinLevel(v as LogLevel)}>
            {(["debug", "info", "warn", "error"] as const).map((l) => <ToggleGroupItem key={l} value={l}>{l}</ToggleGroupItem>)}
          </ToggleGroup>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={module} onChange={(e) => setModule((e.target as HTMLSelectElement).value)}>
            <option value="">{t("log.allAreas")}</option>
            {page?.mods.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Input className="h-8 min-w-32 flex-1 text-base md:text-sm" value={search} placeholder={t("log.search")} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          {error && <div className="p-3 text-sm text-destructive">{error}</div>}
          {page && !page.records.length && <div className="p-6 text-center text-sm text-muted-foreground">{t("log.empty")}</div>}
          {page?.records.map((r, i) => <Line key={i} r={r} />)}
        </div>
        {page?.truncated && <div className="text-xs text-muted-foreground">{t("log.truncated")}</div>}
      </DialogContent>
    </Dialog>
  )
}
