// Mobile: which Mac this phone drives (Settings → Connection).
import { useState } from "preact/hooks"
import { LaptopIcon, LogOutIcon, PlusIcon } from "lucide-react"
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
import { HostList, Panel, Row, Section } from "@/components/settings/layout"
import { relativeTime } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { PairedMac } from "@/lib/pairing"
import { addingMac, connected, forgetPairedMac, pairedMac, pairedMacs, switchMac } from "@/lib/store"
import { cn } from "@/lib/utils"

export function ConnectionSettings() {
  const mac = pairedMac.value
  const [forgetting, setForgetting] = useState<PairedMac | null>(null)
  if (!mac) return null
  // The list comes from the native side; fall back to the one Mac in use if it hasn't loaded yet.
  const macs = pairedMacs.value.length ? pairedMacs.value : [mac]
  return (
    <Section title={t("connection.title")} desc={t("connection.desc")}>
      <Panel>
        {macs.map((m) => {
          const active = m.deviceId === mac.deviceId
          return (
            <Row
              key={m.deviceId}
              label={
                <span className="flex items-center gap-2">
                  <LaptopIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{m.serverName}</span>
                  {active && <span className={cn("size-1.5 shrink-0 rounded-full", connected.value ? "bg-success" : "bg-destructive")} />}
                </span>
              }
              desc={active ? `${t("connection.inUse")} · ${connected.value ? t("sidebar.connected") : t("sidebar.connecting")}` : relativeTime(m.pairedAt)}
            >
              <>
                {!active && (
                  <Button variant="outline" size="sm" onClick={() => void switchMac(m.deviceId)}>
                    {t("connection.switch")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setForgetting(m)}>
                  <LogOutIcon />
                  {t("connection.forget")}
                </Button>
              </>
            </Row>
          )
        })}
      </Panel>
      <div>
        <Button variant="outline" onClick={() => (addingMac.value = true)}>
          <PlusIcon />
          {t("connection.add")}
        </Button>
      </div>

      <Section title={t("connection.details")}>
        <Panel>
          <Row label={t("connection.addresses")} desc={<HostList hosts={mac.hosts} port={mac.port} />} />
          <Row label={t("connection.pairedAt")} desc={relativeTime(mac.pairedAt)} />
          <Row label={t("mobile.fingerprint")} desc={<span className="font-mono text-[11px] select-text">{mac.fingerprint.match(/.{4}/g)?.join(" ")}</span>} />
        </Panel>
      </Section>

      <AlertDialog open={forgetting != null} onOpenChange={(o) => !o && setForgetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("connection.forgetTitle", { name: forgetting?.serverName ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("connection.forgetBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (forgetting) void forgetPairedMac(forgetting.deviceId)
              }}
            >
              {t("connection.forget")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}
