// Adding or editing a model provider from a preset: kind, base URL, key and extra headers.
import { useEffect, useState } from "preact/hooks"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { toast } from "sonner"
import type { ProviderConfig, ProviderKind, RemoteModel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { rpc } from "@/lib/api"
import { refreshProviders } from "@/lib/store"
import { t } from "@/lib/i18n"

export type Presets = Record<ProviderKind, { name: string; baseUrl: string; needsKey: boolean }>

export const KIND_ORDER: ProviderKind[] = ["anthropic", "openai", "google", "deepseek", "openrouter", "amazon-q", "ollama", "openai-compatible"]

export function headersToText(h: Record<string, string>) {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
}

export function textToHeaders(t: string) {
  const out: Record<string, string> = {}
  for (const line of t.split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function ProviderDialog({ open, provider, presets, onClose }: { open: boolean; provider: ProviderConfig | null; presets: Presets | null; onClose: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic")
  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [headers, setHeaders] = useState("")
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const k = provider?.kind ?? "anthropic"
    setKind(k)
    setName(provider?.name ?? presets?.[k].name ?? "")
    setBaseUrl(provider?.baseUrl ?? presets?.[k].baseUrl ?? "")
    setApiKey(provider?.apiKey ?? "")
    setHeaders(headersToText(provider?.headers ?? {}))
    setReveal(false)
  }, [open, provider])

  const changeKind = (k: ProviderKind) => {
    setKind(k)
    if (!provider) {
      setName(presets?.[k].name ?? k)
      setBaseUrl(presets?.[k].baseUrl ?? "")
    }
  }

  const save = async (e: Event) => {
    e.preventDefault()
    setSaving(true)
    try {
      const saved = await rpc<ProviderConfig>("providers.upsert", {
        id: provider?.id ?? "",
        kind,
        name: name.trim() || presets?.[kind].name,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        headers: textToHeaders(headers),
        enabled: provider?.enabled ?? true,
        createdAt: provider?.createdAt ?? 0,
      })
      await refreshProviders()
      if (!provider) {
        try {
          const remote = await rpc<RemoteModel[]>("providers.remoteModels", { id: saved.id })
          const recognized = remote.filter((m) => m.known)
          const known = saved.kind === "amazon-q" ? recognized : recognized.slice(0, 12)
          if (known.length) {
            await rpc("models.addMany", { providerId: saved.id, models: known })
            await refreshProviders()
            toast.success(t("models.addedKnown", { name: saved.name, n: known.length }))
          } else toast.success(t("models.addedPick", { name: saved.name }))
        } catch (err: any) {
          toast.warning(t("models.savedFetchFailed", { msg: err.message }))
        }
      } else toast.success(t("models.saved"))
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{provider ? t("models.editProvider") : t("models.newProvider")}</DialogTitle>
            <DialogDescription>{t("models.providerDesc")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>{t("models.kind")}</FieldLabel>
              <Select value={kind} onValueChange={(v) => changeKind(v as ProviderKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {presets?.[k].name ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("common.name")}</FieldLabel>
              <Input value={name} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("models.baseUrl")}</FieldLabel>
              <Input value={baseUrl} className="font-mono text-xs" onInput={(e) => setBaseUrl(e.currentTarget.value)} placeholder={presets?.[kind].baseUrl} />
              {kind === "amazon-q" && <FieldDescription>{t("models.amazonQDesc")}</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel>API Key{presets && !presets[kind].needsKey && <span className="font-normal text-muted-foreground"> {t("common.optional")}</span>}</FieldLabel>
              <InputGroup className="pointer-coarse:h-auto">
                <InputGroupInput
                  type={(reveal ? "text" : "password") as "password"}
                  value={apiKey}
                  className="font-mono text-xs pointer-coarse:h-11 pointer-coarse:text-base"
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder={kind === "amazon-q" ? "…" : "sk-…"}
                  autoComplete="off"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label={reveal ? t("common.hide") : t("common.show")} onClick={() => setReveal(!reveal)}>
                    {reveal ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>{t("models.headers")}</FieldLabel>
              <Textarea
                value={headers}
                rows={2}
                className="font-mono text-xs"
                placeholder={"X-Custom-Header: value"}
                onInput={(e) => setHeaders(e.currentTarget.value)}
              />
              <FieldDescription>{t("models.headersDesc")}</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
