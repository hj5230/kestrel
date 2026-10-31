// Picking models to add from the list a provider reports.
import { useEffect, useMemo, useState } from "preact/hooks"
import { toast } from "sonner"
import type { ProviderConfig, RemoteModel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { rpc } from "@/lib/api"
import { formatTokens } from "@/lib/format"
import { models, refreshProviders } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

export function FetchModelsDialog({ provider, onClose }: { provider: ProviderConfig | null; onClose: () => void }) {
  const [remote, setRemote] = useState<RemoteModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [manual, setManual] = useState("")
  const existing = useMemo(() => new Set(models.value.filter((m) => m.providerId === provider?.id).map((m) => m.id)), [provider, models.value])

  useEffect(() => {
    if (!provider) return
    setRemote(null)
    setError(null)
    setSelected(new Set())
    setFilter("")
    rpc<RemoteModel[]>("providers.remoteModels", { id: provider.id })
      .then(setRemote)
      .catch((e) => {
        setError(e.message)
        setRemote([])
      })
  }, [provider])

  const shown = (remote ?? []).filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const add = async () => {
    const ids = [...selected]
    for (const id of manual.split(/[\s,]+/).filter(Boolean)) ids.push(id)
    if (!ids.length) return onClose()
    await rpc("models.addMany", {
      providerId: provider!.id,
      models: ids.map((id) => {
        const r = remote?.find((x) => x.id === id)
        return { ...r, id }
      }),
    })
    await refreshProviders()
    toast.success(t("models.addedN", { n: ids.length }))
    onClose()
  }

  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("models.addModelsTo", { name: provider?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("models.addModelsDesc")}</DialogDescription>
        </DialogHeader>
        <Input placeholder={t("models.filter")} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <div className="-mx-1 max-h-72 overflow-y-auto rounded-lg border">
          {remote === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Spinner />
              {t("models.fetching")}
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-xs text-destructive">{error}</div>
          ) : shown.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("models.none")}</div>
          ) : (
            shown.map((m) => {
              const has = existing.has(m.id)
              return (
                <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50", has && "opacity-50")}>
                  <Checkbox checked={has || selected.has(m.id)} disabled={has} onCheckedChange={() => toggle(m.id)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.id}</span>
                  {m.contextWindow && <span className="text-[11px] text-muted-foreground">{formatTokens(m.contextWindow)}</span>}
                  {m.known && <Badge variant="secondary" className="text-[10px]">{t("models.known")}</Badge>}
                  {has && <span className="text-[11px] text-muted-foreground">{t("models.added")}</span>}
                </label>
              )
            })
          )}
        </div>
        <Field>
          <FieldLabel>{t("models.manual")}</FieldLabel>
          <Input placeholder={t("models.manualPlaceholder")} className="font-mono text-xs" value={manual} onInput={(e) => setManual(e.currentTarget.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={add} disabled={!selected.size && !manual.trim()}>
            {selected.size ? t("models.addCount", { n: selected.size }) : t("common.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
