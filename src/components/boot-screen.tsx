import { LaptopIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { t } from "@/lib/i18n"
import { describePairingError, pairingErrorDetail } from "@/lib/pairing"
import { isDesktopApp, isMobileApp } from "@/lib/platform"
import { boot, pairedMac, unpairMac } from "@/lib/store"

export function BootScreen({ error }: { error: string | null }) {
  const mac = isMobileApp ? pairedMac.value : null
  return (
    <div data-tauri-drag-region={isDesktopApp || undefined} className="flex h-full items-center justify-center bg-background px-6">
      {error ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{mac ? <LaptopIcon /> : <TriangleAlertIcon />}</EmptyMedia>
            <EmptyTitle>{mac ? t("boot.macUnreachable", { name: mac.serverName }) : t("boot.failed")}</EmptyTitle>
            <EmptyDescription className="text-xs select-text">
              {mac ? (
                <ul className="mt-1 grid list-disc gap-1 pl-4 text-left">
                  <li>{t("boot.hintRunning")}</li>
                  <li>{t("boot.hintNetwork")}</li>
                  <li>{t("boot.hintRemote")}</li>
                </ul>
              ) : (
                <span className="font-mono">{error}</span>
              )}
            </EmptyDescription>
            {mac && <p className="font-mono text-[11px] break-all text-muted-foreground/70 select-text">{pairingErrorDetail(error) || describePairingError(error)}</p>}
          </EmptyHeader>
          <EmptyContent>
            {mac ? (
              <div className="flex flex-col gap-2">
                <Button onClick={() => void boot()}>
                  <RefreshCwIcon />
                  {t("common.retry")}
                </Button>
                <Button variant="ghost" className="text-muted-foreground" onClick={() => void unpairMac()}>
                  {t("boot.pairOther")}
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => location.reload()}>
                <RefreshCwIcon />
                {t("boot.reload")}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {mac ? t("boot.connectingTo", { name: mac.serverName }) : t("boot.starting")}
        </div>
      )}
    </div>
  )
}
