// The sidebar's update entry, above the status line. It appears as soon as a newer version is known:
// while it downloads (opens Settings > About), once it is ready (one click restarts into it) and, on the
// phone, when the phone's app is behind (opens Settings > About, where the build can be downloaded).
import { ArrowUpCircleIcon, DownloadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { route } from "@/lib/store"
import { checkForUpdate, installUpdate, phoneUpdate, restartBlocked, updateReady, updateStatus } from "@/lib/update"

const openAbout = () => (route.value = { name: "settings", tab: "about" })

export function UpdateButton() {
  const s = updateStatus.value
  const phone = phoneUpdate.value
  const ready = updateReady.value
  const downloading = !phone && (s?.state === "downloading" || s?.state === "checking") && !!s.latest
  const failed = !phone && s?.state === "error" && !!s.latest
  if (!ready && !phone && !downloading && !failed) return null

  const version = phone?.version ?? s?.latest?.version ?? ""
  const blocked = ready && restartBlocked.value
  const pct = s?.progress?.total ? Math.floor((s.progress.done / s.progress.total) * 100) : 0
  const label = phone
    ? `${t("update.available")} · ${version}`
    : downloading
      ? t("update.status.downloading", { version, pct })
      : failed
        ? t("update.failedPill", { version })
        : blocked
        ? t("update.restartBlocked")
        : `${t("update.pill")} · ${version}`
  const Icon = downloading ? DownloadIcon : ArrowUpCircleIcon

  return (
    <Button
      size="sm"
      variant="secondary"
      className="mx-1 justify-start gap-2 pointer-coarse:min-h-10"
      disabled={blocked}
      title={blocked ? t("update.restartBlocked") : undefined}
      onClick={() => {
        const fail = (e: any) => toast.error(e?.message ?? String(e))
        if (ready && !phone) installUpdate().catch(fail)
        else if (failed) checkForUpdate().catch(fail)
        else openAbout()
      }}
    >
      <Icon className={downloading ? "text-muted-foreground" : "text-primary"} />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}
