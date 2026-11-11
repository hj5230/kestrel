// A downloaded update, one click from installing, above the sidebar's status line. On the phone it points
// to Settings > About, where the newer iPhone build can be downloaded.
import { ArrowUpCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { route } from "@/lib/store"
import { installUpdate, phoneUpdate, restartBlocked, updateReady, updateStatus } from "@/lib/update"

export function UpdateButton() {
  const phone = phoneUpdate.value
  if (!updateReady.value && !phone) return null
  const blocked = !phone && restartBlocked.value
  return (
    <Button
      size="sm"
      variant="secondary"
      className="mx-1 justify-start gap-2 pointer-coarse:min-h-10"
      disabled={blocked}
      title={blocked ? t("update.restartBlocked") : undefined}
      onClick={() => (phone ? (route.value = { name: "settings", tab: "about" }) : installUpdate().catch((e) => toast.error(e?.message ?? String(e))))}
    >
      <ArrowUpCircleIcon className="text-primary" />
      <span className="min-w-0 truncate">{blocked ? t("update.restartBlocked") : `${t(phone ? "update.available" : "update.pill")} · ${phone?.version ?? updateStatus.value?.latest?.version ?? ""}`}</span>
    </Button>
  )
}
