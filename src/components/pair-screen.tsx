// Mobile: first-run / re-pair screen. Shown until this phone is paired with a Mac.
import { useState } from "preact/hooks"
import { ClipboardPasteIcon, ScanQrCodeIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Logo } from "@/components/logo"
import { t } from "@/lib/i18n"
import { defaultDeviceName, describePairingError, pairingErrorDetail, pairWithMac, scanPairingCode } from "@/lib/pairing"
import { adoptPairedMac, deviceRevoked } from "@/lib/store"

export function PairScreen() {
  const [name, setName] = useState(defaultDeviceName)
  const [pasting, setPasting] = useState(false)
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const pair = async (payload: string) => {
    setBusy(true)
    setError(null)
    try {
      adoptPairedMac(await pairWithMac(payload, name.trim() || defaultDeviceName()))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const scan = async () => {
    setError(null)
    try {
      const code = await scanPairingCode()
      if (code) await pair(code)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">{t("pair.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pair.sub")}</p>
        </div>

        {deviceRevoked.value && (
          <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            {t("pair.revoked")}
          </div>
        )}

        <ol className="grid list-decimal gap-2 rounded-xl border bg-card p-4 pl-8 text-sm text-muted-foreground">
          <li>{t("pair.step1")}</li>
          <li>{t("pair.step2")}</li>
          <li>{t("pair.step3")}</li>
        </ol>

        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            {t("pair.deviceName")}
            <Input value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={80} />
          </label>

          {busy ? (
            <div className="flex h-11 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t("pair.connecting")}
            </div>
          ) : (
            <>
              <Button size="lg" className="h-11" onClick={scan}>
                <ScanQrCodeIcon />
                {t("pair.scan")}
              </Button>
              {pasting ? (
                <form
                  className="grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (link.trim()) void pair(link)
                  }}
                >
                  <Textarea
                    autoFocus
                    rows={3}
                    className="font-mono text-xs"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellcheck={false}
                    placeholder="kestrel://pair?…"
                    value={link}
                    onInput={(e) => setLink(e.currentTarget.value)}
                  />
                  <Button type="submit" variant="secondary" className="h-11" disabled={!link.trim()}>
                    {t("pair.connect")}
                  </Button>
                </form>
              ) : (
                <Button variant="ghost" className="h-11 text-muted-foreground" onClick={() => setPasting(true)}>
                  <ClipboardPasteIcon />
                  {t("pair.paste")}
                </Button>
              )}
            </>
          )}

          {error != null && (
            <div className="grid gap-1 text-center">
              <p className="text-sm text-destructive">{describePairingError(error)}</p>
              {pairingErrorDetail(error) && <p className="font-mono text-[11px] break-all text-muted-foreground select-text">{pairingErrorDetail(error)}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
