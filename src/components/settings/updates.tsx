// Settings > About > Updates. On the Mac: what the background updater is doing, and the choices for it.
// On the phone: whether this phone's app is behind, with a link to the build to sideload.
import { useState } from "preact/hooks"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Panel, Row, Section } from "@/components/settings/layout"
import { clockTime } from "@/lib/format"
import { t } from "@/lib/i18n"
import { isMobileApp } from "@/lib/platform"
import { settings } from "@/lib/store"
import { checkForUpdate, installUpdate, phoneUpdate, restartBlocked, updateStatus } from "@/lib/update"
import { save } from "./fields"

function statusText(): string {
  const s = updateStatus.value
  if (!s) return ""
  const v = s.latest?.version ?? ""
  switch (s.state) {
    case "disabled": return t("update.status.disabled")
    case "checking": return t("update.status.checking")
    case "downloading": return t("update.status.downloading", { version: v, pct: s.progress?.total ? Math.floor((s.progress.done / s.progress.total) * 100) : 0 })
    case "ready": return t("update.status.ready", { version: v })
    case "error": return t("update.status.error", { error: s.error ?? "" })
    default: return t("update.status.idle")
  }
}

export function Updates() {
  const s = updateStatus.value
  const prefs = settings.value
  const [busy, setBusy] = useState(false)
  if (isMobileApp) {
    const p = phoneUpdate.value
    return (
      <Section title={t("update.title")}>
        <Panel>
          <Row label={t("update.phoneVersion")} desc={<span className="font-mono">{__APP_VERSION__}</span>}>
            {p && <Button size="sm" asChild><a href={p.page} target="_blank" rel="noreferrer">{t("update.download")}</a></Button>}
          </Row>
          {p && <Row label={t("update.phone", { version: p.version })} />}
        </Panel>
      </Section>
    )
  }
  if (!s || !prefs) return null
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    try { await fn() } catch (e: any) { toast.error(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  const working = s.state === "checking" || s.state === "downloading"
  return (
    <Section title={t("update.title")} desc={t("update.desc")}>
      <Panel>
        <Row label={statusText()} desc={s.checkedAt ? t("update.checkedAt", { time: clockTime(s.checkedAt) }) : undefined}>
          {s.state === "ready" ? (
            <Button size="sm" disabled={busy || restartBlocked.value} title={restartBlocked.value ? t("update.restartBlocked") : undefined} onClick={run(installUpdate)}>
              {restartBlocked.value ? t("update.restartBlocked") : t("update.restart")}
            </Button>
          ) : s.state !== "disabled" && (
            <Button size="sm" variant="outline" disabled={busy || working} onClick={run(checkForUpdate)}>
              {s.state === "error" ? t("common.retry") : t("update.check")}
            </Button>
          )}
        </Row>
        {s.latest?.notes && (
          <Row label={t("update.notes", { version: s.latest.version })} desc={<span className="whitespace-pre-wrap">{s.latest.notes}</span>} />
        )}
        <Row label={t("update.auto")} desc={t("update.autoDesc")}>
          <Switch checked={prefs.updateAutoCheck} onCheckedChange={(v) => save({ updateAutoCheck: v })} />
        </Row>
        <Row label={t("update.channel")} desc={t("update.channelDesc")}>
          <ToggleGroup type="single" variant="outline" size="sm" value={prefs.updateChannel} onValueChange={(v) => v && save({ updateChannel: v as "beta" | "stable" })}>
            <ToggleGroupItem value="beta">{t("update.beta")}</ToggleGroupItem>
            <ToggleGroupItem value="stable">{t("update.stable")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Panel>
    </Section>
  )
}
