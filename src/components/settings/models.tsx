import { useEffect, useMemo, useState } from "preact/hooks"
import {
  BrainIcon,
  CloudDownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import type { ModelConfig, ProviderConfig, ProviderKind, RemoteModel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Section } from "./layout"
import { rpc } from "@/lib/api"
import { formatTokens } from "@/lib/format"
import { models, providers, refreshProviders } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

type Presets = Record<ProviderKind, { name: string; baseUrl: string; needsKey: boolean }>

const KIND_ORDER: ProviderKind[] = ["anthropic", "openai", "google", "deepseek", "openrouter", "ollama", "openai-compatible"]

function headersToText(h: Record<string, string>) {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
}

function textToHeaders(t: string) {
  const out: Record<string, string> = {}
  for (const line of t.split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function ProviderDialog({ open, provider, presets, onClose }: { open: boolean; provider: ProviderConfig | null; presets: Presets | null; onClose: () => void }) {
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
          const known = remote.filter((m) => m.known).slice(0, 12)
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
      <DialogContent className="sm:max-w-lg">
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
            </Field>
            <Field>
              <FieldLabel>API Key{presets && !presets[kind].needsKey && <span className="font-normal text-muted-foreground"> {t("common.optional")}</span>}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  type={(reveal ? "text" : "password") as "password"}
                  value={apiKey}
                  className="font-mono text-xs"
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  placeholder="sk-…"
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

/**
 * A number field that keeps what is typed as text ("0.", "0.00") and hands up the number. Any decimal
 * is valid: a fixed step made values like 0.008 "invalid", and a controlled number would rewrite
 * the text mid-typing.
 */
function NumField({ value, onValue, as: Comp = Input }: { value: number; onValue: (n: number) => void; as?: typeof Input }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
  }, [value])
  return (
    <Comp
      type="number"
      step="any"
      min={0}
      inputMode="decimal"
      value={text}
      onInput={(e) => {
        setText(e.currentTarget.value)
        const n = Number(e.currentTarget.value)
        onValue(e.currentTarget.value === "" || !Number.isFinite(n) ? 0 : n)
      }}
    />
  )
}

function ModelDialog({ model, onClose }: { model: ModelConfig | null; onClose: () => void }) {
  const [m, setM] = useState<ModelConfig | null>(model)
  useEffect(() => setM(model), [model])
  if (!m) return null
  const set = (patch: Partial<ModelConfig>) => setM({ ...m, ...patch })
  const setCost = (patch: Partial<ModelConfig["cost"]>) => setM({ ...m, cost: { ...m.cost, ...patch } })
  const save = async (e: Event) => {
    e.preventDefault()
    try {
      await rpc("models.upsert", m)
      await refreshProviders()
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    }
  }
  return (
    <Dialog open={!!model} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("models.params")}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{m.id}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>{t("models.displayName")}</FieldLabel>
              <Input value={m.name} onInput={(e) => set({ name: e.currentTarget.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("models.contextWindow")}</FieldLabel>
                <NumField value={m.contextWindow} onValue={(n) => set({ contextWindow: n })} />
              </Field>
              <Field>
                <FieldLabel>{t("models.maxOutput")}</FieldLabel>
                <NumField value={m.maxTokens} onValue={(n) => set({ maxTokens: n })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["input", t("models.priceInput")],
                  ["output", t("models.priceOutput")],
                  ["cacheRead", t("models.priceCacheRead")],
                  ["cacheWrite", t("models.priceCacheWrite")],
                ] as const
              ).map(([k, label]) => (
                <Field key={k}>
                  <FieldLabel>{label}</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>$</InputGroupAddon>
                    <NumField as={InputGroupInput} value={m.cost[k]} onValue={(n) => setCost({ [k]: n })} />
                    <InputGroupAddon align="inline-end" className="text-xs">
                      / 1M
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              ))}
            </div>
            <div className="flex gap-6">
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={m.reasoning} onCheckedChange={(v) => set({ reasoning: !!v })} />
                {t("models.reasoning")}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={m.vision} onCheckedChange={(v) => set({ vision: !!v })} />
                {t("models.vision")}
              </Label>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FetchModelsDialog({ provider, onClose }: { provider: ProviderConfig | null; onClose: () => void }) {
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
        return { id, contextWindow: r?.contextWindow, cost: r?.cost }
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

export function ModelsSettings() {
  const [presets, setPresets] = useState<Presets | null>(null)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editModel, setEditModel] = useState<ModelConfig | null>(null)
  const [fetchFor, setFetchFor] = useState<ProviderConfig | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => {
    rpc<Presets>("providers.presets").then(setPresets)
  }, [])

  const test = async (m: ModelConfig) => {
    const key = `${m.providerId}/${m.id}`
    setTesting(key)
    try {
      const r = await rpc<{ text: string; ms: number }>("providers.test", { providerId: m.providerId, modelId: m.id })
      toast.success(t("models.ok", { name: m.name }), { description: t("models.okDesc", { text: r.text.trim().slice(0, 40), s: (r.ms / 1000).toFixed(1) }) })
    } catch (e: any) {
      toast.error(t("models.failed", { name: m.name }), { description: e.message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <Section
      title={t("models.title")}
      desc={t("models.desc")}
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon />
          {t("models.addProvider")}
        </Button>
      }
    >
      {providers.value.length === 0 && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>{t("models.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("models.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <PlusIcon />
              {t("models.addProvider")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {providers.value.map((p) => {
        const list = models.value.filter((m) => m.providerId === p.id)
        return (
          <div key={p.id} className={cn("overflow-hidden rounded-xl border bg-card", !p.enabled && "opacity-60")}>
            <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {presets?.[p.kind]?.name ?? p.kind}
                  </Badge>
                  {!p.apiKey && presets?.[p.kind]?.needsKey && <Badge variant="destructive" className="text-[10px]">{t("models.missingKey")}</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground select-text">{p.baseUrl || presets?.[p.kind]?.baseUrl}</div>
              </div>
              {/* Phones: "add models" moves into the ⋯ menu so the name and URL keep their width. */}
              <Button variant="outline" size="sm" className="max-sm:hidden" onClick={() => setFetchFor(p)}>
                <CloudDownloadIcon />
                {t("models.addModels")}
              </Button>
              <Switch
                checked={p.enabled}
                onCheckedChange={async (v) => {
                  await rpc("providers.upsert", { ...p, enabled: v })
                  refreshProviders()
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="sm:hidden" onSelect={() => setFetchFor(p)}>
                    <CloudDownloadIcon />
                    {t("models.addModels")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(p)
                      setDialogOpen(true)
                    }}
                  >
                    <PencilIcon />
                    {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={async () => {
                      await rpc("providers.delete", { id: p.id })
                      refreshProviders()
                    }}
                  >
                    <Trash2Icon />
                    {t("models.deleteProvider")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {list.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-muted-foreground">{t("models.noModelsYet")}</div>
            ) : (
              <div className="divide-y">
                {list.map((m) => (
                  <div key={m.id} className="group/model flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{m.name}</span>
                        {m.reasoning && <BrainIcon className="size-3.5 text-muted-foreground" />}
                        {m.vision && <ImageIcon className="size-3.5 text-muted-foreground" />}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground select-text">
                        {m.id} · {t("models.contextN", { n: formatTokens(m.contextWindow) })}
                        {m.cost.input || m.cost.output ? t("models.perM", { in: +m.cost.input.toFixed(3), out: +m.cost.output.toFixed(3) }) : ""}
                      </div>
                    </div>
                    {/* Mouse: hover reveals the actions. Touch: one ⋯ menu, so the model name keeps the row. */}
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/model:opacity-100 pointer-coarse:hidden">
                      <Button variant="ghost" size="icon-sm" title={t("models.test")} onClick={() => test(m)} disabled={testing !== null}>
                        {testing === `${m.providerId}/${m.id}` ? <Spinner /> : <PlayIcon />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" title={t("common.edit")} onClick={() => setEditModel(m)}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t("common.remove")}
                        onClick={async () => {
                          await rpc("models.delete", { providerId: m.providerId, id: m.id })
                          refreshProviders()
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    {testing === `${m.providerId}/${m.id}` ? (
                      <Spinner className="hidden pointer-coarse:block" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="hidden pointer-coarse:inline-flex" aria-label={t("common.moreActions")} disabled={testing !== null}>
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => test(m)}>
                            <PlayIcon />
                            {t("models.test")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditModel(m)}>
                            <PencilIcon />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={async () => {
                              await rpc("models.delete", { providerId: m.providerId, id: m.id })
                              refreshProviders()
                            }}
                          >
                            <Trash2Icon />
                            {t("common.remove")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={async (v) => {
                        await rpc("models.upsert", { ...m, enabled: v })
                        refreshProviders()
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <ProviderDialog open={dialogOpen} provider={editing} presets={presets} onClose={() => setDialogOpen(false)} />
      <ModelDialog model={editModel} onClose={() => setEditModel(null)} />
      <FetchModelsDialog provider={fetchFor} onClose={() => setFetchFor(null)} />
    </Section>
  )
}
