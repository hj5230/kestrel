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
            toast.success(`已添加 ${saved.name}，自动导入 ${known.length} 个已知模型`)
          } else toast.success(`已添加 ${saved.name}，可点击「获取模型」选择要使用的模型`)
        } catch (err: any) {
          toast.warning(`已保存，但获取模型列表失败：${err.message}`)
        }
      } else toast.success("已保存")
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
            <DialogTitle>{provider ? "编辑供应商" : "添加模型供应商"}</DialogTitle>
            <DialogDescription>通过 Vercel AI SDK 接入。API Key 只保存在本机数据库中。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>类型</FieldLabel>
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
              <FieldLabel>名称</FieldLabel>
              <Input value={name} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field>
              <FieldLabel>Base URL</FieldLabel>
              <Input value={baseUrl} className="font-mono text-xs" onInput={(e) => setBaseUrl(e.currentTarget.value)} placeholder={presets?.[kind].baseUrl} />
            </Field>
            <Field>
              <FieldLabel>API Key{presets && !presets[kind].needsKey && <span className="font-normal text-muted-foreground">（可选）</span>}</FieldLabel>
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
                  <InputGroupButton size="icon-xs" onClick={() => setReveal(!reveal)}>
                    {reveal ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>自定义请求头</FieldLabel>
              <Textarea
                value={headers}
                rows={2}
                className="font-mono text-xs"
                placeholder={"X-Custom-Header: value"}
                onInput={(e) => setHeaders(e.currentTarget.value)}
              />
              <FieldDescription>每行一个，格式为「名称: 值」。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ModelDialog({ model, onClose }: { model: ModelConfig | null; onClose: () => void }) {
  const [m, setM] = useState<ModelConfig | null>(model)
  useEffect(() => setM(model), [model])
  if (!m) return null
  const num = (v: string) => (v === "" ? 0 : Number(v))
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
            <DialogTitle>模型参数</DialogTitle>
            <DialogDescription className="font-mono text-xs">{m.id}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>显示名称</FieldLabel>
              <Input value={m.name} onInput={(e) => set({ name: e.currentTarget.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>上下文窗口</FieldLabel>
                <Input type="number" value={m.contextWindow} onInput={(e) => set({ contextWindow: num(e.currentTarget.value) })} />
              </Field>
              <Field>
                <FieldLabel>最大输出</FieldLabel>
                <Input type="number" value={m.maxTokens} onInput={(e) => set({ maxTokens: num(e.currentTarget.value) })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["input", "输入单价"],
                  ["output", "输出单价"],
                  ["cacheRead", "缓存读取单价"],
                  ["cacheWrite", "缓存写入单价"],
                ] as const
              ).map(([k, label]) => (
                <Field key={k}>
                  <FieldLabel>{label}</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>$</InputGroupAddon>
                    <InputGroupInput type="number" step="0.01" value={m.cost[k]} onInput={(e) => setCost({ [k]: num(e.currentTarget.value) })} />
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
                支持推理
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={m.vision} onCheckedChange={(v) => set({ vision: !!v })} />
                支持图片输入
              </Label>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
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
    toast.success(`已添加 ${ids.length} 个模型`)
    onClose()
  }

  return (
    <Dialog open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>添加模型 · {provider?.name}</DialogTitle>
          <DialogDescription>从服务端拉取的模型列表中勾选，或手动输入模型 ID。已知模型会自动填充上下文窗口和单价。</DialogDescription>
        </DialogHeader>
        <Input placeholder="筛选…" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <div className="-mx-1 max-h-72 overflow-y-auto rounded-lg border">
          {remote === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Spinner />
              正在获取…
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-center text-xs text-destructive">{error}</div>
          ) : shown.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">没有模型</div>
          ) : (
            shown.map((m) => {
              const has = existing.has(m.id)
              return (
                <label key={m.id} className={cn("flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-muted/50", has && "opacity-50")}>
                  <Checkbox checked={has || selected.has(m.id)} disabled={has} onCheckedChange={() => toggle(m.id)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.id}</span>
                  {m.contextWindow && <span className="text-[11px] text-muted-foreground">{formatTokens(m.contextWindow)}</span>}
                  {m.known && <Badge variant="secondary" className="text-[10px]">已知</Badge>}
                  {has && <span className="text-[11px] text-muted-foreground">已添加</span>}
                </label>
              )
            })
          )}
        </div>
        <Field>
          <FieldLabel>手动添加</FieldLabel>
          <Input placeholder="模型 ID，多个用逗号分隔" className="font-mono text-xs" value={manual} onInput={(e) => setManual(e.currentTarget.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={add} disabled={!selected.size && !manual.trim()}>
            添加{selected.size ? ` ${selected.size} 个` : ""}
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
      toast.success(`${m.name} 可用`, { description: `响应「${r.text.trim().slice(0, 40)}」，耗时 ${(r.ms / 1000).toFixed(1)}s` })
    } catch (e: any) {
      toast.error(`${m.name} 调用失败`, { description: e.message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <Section
      title="模型供应商"
      desc="Helm 通过 Vercel AI SDK 统一接入各家模型；也支持本地 Ollama 与任意 OpenAI 兼容服务。"
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon />
          添加供应商
        </Button>
      }
    >
      {providers.value.length === 0 && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>还没有供应商</EmptyTitle>
            <EmptyDescription>添加一个供应商并选择模型后，就可以开始对话了。</EmptyDescription>
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
              添加供应商
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
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {presets?.[p.kind]?.name ?? p.kind}
                  </Badge>
                  {!p.apiKey && presets?.[p.kind]?.needsKey && <Badge variant="destructive" className="text-[10px]">缺少 API Key</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{p.baseUrl || presets?.[p.kind]?.baseUrl}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setFetchFor(p)}>
                <CloudDownloadIcon />
                添加模型
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
                  <Button variant="ghost" size="icon-sm">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(p)
                      setDialogOpen(true)
                    }}
                  >
                    <PencilIcon />
                    编辑
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
                    删除供应商
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {list.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-muted-foreground">尚未添加模型</div>
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
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {m.id} · {formatTokens(m.contextWindow)} 上下文
                        {m.cost.input || m.cost.output ? ` · $${m.cost.input}/$${m.cost.output} 每百万` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/model:opacity-100">
                      <Button variant="ghost" size="icon-sm" title="测试调用" onClick={() => test(m)} disabled={testing !== null}>
                        {testing === `${m.providerId}/${m.id}` ? <Spinner /> : <PlayIcon />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="编辑" onClick={() => setEditModel(m)}>
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="移除"
                        onClick={async () => {
                          await rpc("models.delete", { providerId: m.providerId, id: m.id })
                          refreshProviders()
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
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
