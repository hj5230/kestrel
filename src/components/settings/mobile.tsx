// Desktop: let phones drive this Mac's agent (Settings → Mobile).
import { useEffect, useMemo, useState } from "preact/hooks"
import { CopyIcon, QrCodeIcon, RotateCcwIcon, SmartphoneIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { renderSVG } from "uqr"
import type { RemoteStatus } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
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
import { rpc } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import { t } from "@/lib/i18n"
import { remoteStatus } from "@/lib/store"
import { cn } from "@/lib/utils"

function call(method: string, params: object = {}) {
  return rpc<RemoteStatus>(method, params)
    .then((s) => (remoteStatus.value = s))
    .catch((e) => {
      toast.error(e.message)
      return null
    })
}

function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  if (!until) return ""
  const s = Math.max(0, Math.round((until - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function PairingCode({ status }: { status: RemoteStatus }) {
  const offer = status.pairing
  const left = useCountdown(offer?.expiresAt)
  const svg = useMemo(() => (offer ? renderSVG(offer.url, { ecc: "M", border: 2, pixelSize: 6 }) : ""), [offer?.url])

  if (!offer) {
    return (
      <div>
        <Button onClick={() => call("remote.pairingStart")} disabled={!status.running}>
          <QrCodeIcon />
          {t("mobile.showCode")}
        </Button>
      </div>
    )
  }
  return (
    <Panel>
      <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-start">
        <div className="size-48 shrink-0 overflow-hidden rounded-lg bg-white p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="grid min-w-0 gap-3 text-sm">
          <ol className="grid list-decimal gap-1.5 pl-4 text-muted-foreground">
            <li>{t("mobile.step1")}</li>
            <li>{t("mobile.step2")}</li>
            <li>{t("mobile.step3")}</li>
          </ol>
          <p className="text-xs text-muted-foreground">{t("mobile.expiresIn", { time: left })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(offer.url).then(() => toast.success(t("mobile.linkCopied")))}
            >
              <CopyIcon />
              {t("mobile.copyLink")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => call("remote.pairingCancel")}>
              <XIcon />
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  )
}

export function MobileSettings() {
  const status = remoteStatus.value
  const [port, setPort] = useState("")
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    call("remote.status")
  }, [])
  useEffect(() => setPort(String(status?.port ?? "")), [status?.port])

  // A phone just redeemed the code: the offer disappears and a device is added.
  const count = status?.devices.length ?? 0
  const [seen, setSeen] = useState<number | null>(null)
  useEffect(() => {
    if (seen !== null && count > seen) toast.success(t("mobile.paired"))
    setSeen(count)
  }, [count])

  if (!status) return null
  const commitPort = () => {
    const n = Number(port)
    if (n !== status.port) call("remote.configure", { port: n }).then((s) => !s && setPort(String(status.port)))
  }

  return (
    <div className="grid gap-8">
      <Section title={t("mobile.title")} desc={t("mobile.desc")}>
        <Panel>
          <Row label={t("mobile.enable")} desc={t("mobile.enableDesc")}>
            <Switch checked={status.enabled} onCheckedChange={(v) => call("remote.configure", { enabled: v })} />
          </Row>
          <Row label={t("mobile.port")} desc={status.error ? <span className="text-destructive">{status.error}</span> : undefined}>
            <Input
              className="w-24 font-mono"
              inputMode="numeric"
              value={port}
              onInput={(e) => setPort(e.currentTarget.value.replace(/\D/g, ""))}
              onBlur={commitPort}
              onKeyDown={(e) => e.key === "Enter" && commitPort()}
            />
          </Row>
          {status.running && (
            <Row
              label={t("mobile.addresses")}
              desc={<span className="font-mono select-text">{status.hosts.map((h) => `${h}:${status.port}`).join("  ·  ")}</span>}
            />
          )}
        </Panel>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("mobile.trustNote")}</p>
      </Section>

      {status.running && (
        <Section title={t("mobile.pairTitle")} desc={t("mobile.pairDesc")}>
          <PairingCode status={status} />
        </Section>
      )}

      <Section title={t("mobile.devices")}>
        <Panel>
          {status.devices.length === 0 && <Row label={<span className="font-normal text-muted-foreground">{t("mobile.noDevices")}</span>} />}
          {status.devices.map((d) => (
            <Row
              key={d.id}
              label={
                <span className="flex items-center gap-2">
                  <SmartphoneIcon className="size-4 text-muted-foreground" />
                  {d.name}
                  <span className={cn("size-1.5 rounded-full", d.online ? "bg-success" : "bg-muted-foreground/40")} />
                </span>
              }
              desc={t("mobile.deviceMeta", {
                paired: relativeTime(d.createdAt),
                seen: d.online ? t("mobile.online") : relativeTime(d.lastSeenAt),
              })}
            >
              <Button variant="outline" size="sm" onClick={() => call("remote.revoke", { id: d.id }).then((s) => s && toast.success(t("mobile.removed")))}>
                {t("common.remove")}
              </Button>
            </Row>
          ))}
        </Panel>
        {status.fingerprint && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-muted-foreground select-text">
              {t("mobile.fingerprint")} {status.fingerprint.match(/.{4}/g)?.join(" ")}
            </p>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setResetting(true)}>
              <RotateCcwIcon />
              {t("mobile.resetCert")}
            </Button>
          </div>
        )}
      </Section>

      <AlertDialog open={resetting} onOpenChange={setResetting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mobile.resetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("mobile.resetBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => call("remote.resetCertificate")}>
              {t("mobile.resetCert")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
