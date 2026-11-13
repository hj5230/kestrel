// Settings > About > Logs: how much is logged, how long it is kept, and a way to read, export or open the files.
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { LogInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel, Row, Section } from "@/components/settings/layout"
import { logExport, logInfo, logReveal } from "@/lib/log-view"
import { t } from "@/lib/i18n"
import { isMobileApp, isTauri } from "@/lib/platform"
import { settings, updateSettings } from "@/lib/store"
import { LogsDialog } from "./logs-dialog"

const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function Logs() {
  const [info, setInfo] = useState<LogInfo | null>(null)
  const [viewing, setViewing] = useState(false)
  const prefs = settings.value
  const reload = () => logInfo().then(setInfo).catch(() => setInfo(null))
  useEffect(() => { if (isTauri) void reload() }, [])
  if (!isTauri || !prefs) return null
  const bytes = (tier: string) => info?.files.filter((f) => f.tier === tier).reduce((n, f) => n + f.size, 0) ?? 0
  const level = prefs.logLevel
  return (
    <Section title={t("log.title")} desc={t("log.desc", { routine: info?.routineDays ?? 7, important: info?.importantDays ?? 90 })}>
      <Panel>
        <Row label={t("log.level")} desc={t(level === "verbose" ? "log.levelVerboseDesc" : "log.levelNormalDesc")}>
          <ToggleGroup type="single" variant="outline" size="sm" value={level} onValueChange={(v) => v && updateSettings({ logLevel: v as "normal" | "verbose" }).then(reload)}>
            <ToggleGroupItem value="normal">{t("log.normal")}</ToggleGroupItem>
            <ToggleGroupItem value="verbose">{t("log.verbose")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        {info && <Row label={t("log.size")} desc={t("log.sizeDesc", { routine: size(bytes("routine")), important: size(bytes("important")) })} />}
        {info && <Row label={t("log.folder")} desc={<span className="font-mono select-text">{info.dir}</span>} />}
      </Panel>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setViewing(true)}>{t("log.view")}</Button>
        {!isMobileApp && (
          <>
            <Button variant="outline" size="sm" onClick={() => logReveal().catch((e) => toast.error(String(e)))}>{t("log.open")}</Button>
            <Button variant="outline" size="sm" onClick={() => logExport().then(() => toast.success(t("log.exported"))).catch((e) => toast.error(String(e)))}>{t("log.export")}</Button>
          </>
        )}
      </div>
      <LogsDialog open={viewing} onOpenChange={setViewing} />
    </Section>
  )
}
