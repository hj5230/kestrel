// Mobile: which Mac this phone drives (Settings → Connection).
import { useState } from "preact/hooks"
import { LogOutIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Panel, Row, Section } from "@/components/settings/layout"
import { relativeTime } from "@/lib/format"
import { t } from "@/lib/i18n"
import { connected, pairedMac, unpairMac } from "@/lib/store"
import { cn } from "@/lib/utils"

export function ConnectionSettings() {
  const mac = pairedMac.value
  const [confirming, setConfirming] = useState(false)
  if (!mac) return null
  return (
    <Section title={t("connection.title")} desc={t("connection.desc")}>
      <Panel>
        <Row
          label={
            <span className="flex items-center gap-2">
              {mac.serverName}
              <span className={cn("size-1.5 rounded-full", connected.value ? "bg-success" : "bg-destructive")} />
            </span>
          }
          desc={connected.value ? t("sidebar.connected") : t("sidebar.connecting")}
        />
        <Row label={t("connection.addresses")} desc={<span className="font-mono break-all select-text">{mac.hosts.map((h) => `${h}:${mac.port}`).join("  ·  ")}</span>} />
        <Row label={t("connection.pairedAt")} desc={relativeTime(mac.pairedAt)} />
        <Row label={t("mobile.fingerprint")} desc={<span className="font-mono text-[11px] select-text">{mac.fingerprint.match(/.{4}/g)?.join(" ")}</span>} />
      </Panel>
      <div>
        <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
          <LogOutIcon />
          {t("connection.forget")}
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("connection.forgetTitle", { name: mac.serverName })}</AlertDialogTitle>
            <AlertDialogDescription>{t("connection.forgetBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void unpairMac()}>
              {t("connection.forget")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}
