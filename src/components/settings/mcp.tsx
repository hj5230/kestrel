import { useEffect, useState } from "preact/hooks"
import { ChevronRightIcon, FileJsonIcon, MoreHorizontalIcon, PencilIcon, PlugIcon, PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { McpServerConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Section } from "./layout"
import { rpc } from "@/lib/api"
import { mcpServers } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

const kvToText = (o: Record<string, string>, sep: string) =>
  Object.entries(o)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n")

function textToKv(t: string, sep: string) {
  const out: Record<string, string> = {}
  for (const line of t.split("\n")) {
    const i = line.indexOf(sep)
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim()
  }
  return out
}

function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a)

function ServerDialog({ open, server, onClose }: { open: boolean; server: McpServerConfig | null; onClose: () => void }) {
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<McpServerConfig["transport"]>("stdio")
  const [command, setCommand] = useState("")
  const [env, setEnv] = useState("")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(server?.name ?? "")
    setTransport(server?.transport ?? "stdio")
    setCommand(server ? [server.command, ...server.args].filter(Boolean).map(quote).join(" ") : "")
    setEnv(kvToText(server?.env ?? {}, "="))
    setUrl(server?.url ?? "")
    setHeaders(kvToText(server?.headers ?? {}, ": "))
  }, [open, server])

  const save = async (e: Event) => {
    e.preventDefault()
    if (!name.trim()) return toast.error(t("mcp.nameRequired"))
    const parts = splitArgs(command)
    setSaving(true)
    try {
      await rpc("mcp.upsert", {
        id: server?.id ?? "",
        name: name.trim(),
        transport,
        command: transport === "stdio" ? (parts[0] ?? "") : "",
        args: transport === "stdio" ? parts.slice(1) : [],
        env: textToKv(env, "="),
        url: transport === "stdio" ? "" : url.trim(),
        headers: textToKv(headers, ":"),
        enabled: server?.enabled ?? true,
      })
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
            <DialogTitle>{server ? t("mcp.edit") : t("mcp.add")}</DialogTitle>
            <DialogDescription>{t("mcp.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>{t("common.name")}</FieldLabel>
              <Input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="filesystem" />
            </Field>
            <Field>
              <FieldLabel>{t("mcp.transport")}</FieldLabel>
              <ToggleGroup type="single" variant="outline" size="sm" value={transport} onValueChange={(v) => v && setTransport(v as any)} className="justify-start">
                <ToggleGroupItem value="stdio" className="px-3">stdio</ToggleGroupItem>
                <ToggleGroupItem value="http" className="px-3">HTTP</ToggleGroupItem>
                <ToggleGroupItem value="sse" className="px-3">SSE</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {transport === "stdio" ? (
              <>
                <Field>
                  <FieldLabel>{t("mcp.command")}</FieldLabel>
                  <Input
                    value={command}
                    className="font-mono text-xs"
                    onInput={(e) => setCommand(e.currentTarget.value)}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents"
                  />
                  <FieldDescription>{t("mcp.commandDesc")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>{t("mcp.env")}</FieldLabel>
                  <Textarea rows={2} value={env} className="font-mono text-xs" onInput={(e) => setEnv(e.currentTarget.value)} placeholder="API_TOKEN=xxx" />
                </Field>
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel>URL</FieldLabel>
                  <Input value={url} className="font-mono text-xs" onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://example.com/mcp" />
                </Field>
                <Field>
                  <FieldLabel>{t("mcp.headers")}</FieldLabel>
                  <Textarea rows={2} value={headers} className="font-mono text-xs" onInput={(e) => setHeaders(e.currentTarget.value)} placeholder="Authorization: Bearer xxx" />
                </Field>
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              {t("mcp.saveConnect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [json, setJson] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const n = await rpc<number>("mcp.import", { json })
      toast.success(t("mcp.imported", { n }))
      setJson("")
      onClose()
    } catch (e: any) {
      toast.error(t("mcp.importFailed", { msg: e.message }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("mcp.importTitle")}</DialogTitle>
          <DialogDescription>{t("mcp.importDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={12}
          value={json}
          className="font-mono text-xs"
          onInput={(e) => setJson(e.currentTarget.value)}
          placeholder={`{\n  "mcpServers": {\n    "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] }\n  }\n}`}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!json.trim() || busy}>
            {busy && <Spinner />}
            {t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATE: Record<string, string> = {
  connected: "bg-success",
  connecting: "bg-warning animate-pulse",
  error: "bg-destructive",
  disabled: "bg-muted-foreground/40",
}

export function McpSettings() {
  const [configs, setConfigs] = useState<McpServerConfig[]>([])
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [dialog, setDialog] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const load = () =>
    rpc<{ configs: McpServerConfig[]; statuses: any[] }>("mcp.list").then((r) => {
      setConfigs(r.configs)
      mcpServers.value = r.statuses
    })
  useEffect(() => {
    load()
  }, [mcpServers.value.length])

  return (
    <Section
      title={t("mcp.title")}
      desc={t("mcp.desc")}
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <FileJsonIcon />
            {t("mcp.importJson")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialog(true)
            }}
          >
            <PlusIcon />
            {t("mcp.addServer")}
          </Button>
        </div>
      }
    >
      {configs.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>{t("mcp.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("mcp.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {configs.map((cfg) => {
            const st = mcpServers.value.find((s) => s.id === cfg.id)
            const stateKey = st?.state ?? (cfg.enabled ? "connecting" : "disabled")
            const state = { cls: STATE[stateKey], label: t(`mcp.state.${stateKey}` as MessageKey) }
            return (
              <Collapsible key={cfg.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="group/trig flex min-w-0 flex-1 items-center gap-3 text-left">
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/trig:rotate-90" />
                      <span className={cn("size-2 shrink-0 rounded-full", state.cls)} title={state.label} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{cfg.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {cfg.transport}
                          </Badge>
                          {st?.state === "connected" && <span className="text-xs text-muted-foreground">{t("mcp.toolsN", { n: st.tools.length })}</span>}
                        </div>
                        <div className={cn("truncate font-mono text-[11px] text-muted-foreground select-text", st?.state === "error" && "text-destructive")}>
                          {st?.state === "error" ? st.error : cfg.transport === "stdio" ? [cfg.command, ...cfg.args].join(" ") : cfg.url}
                        </div>
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <Switch
                    checked={cfg.enabled}
                    onCheckedChange={async (v) => {
                      await rpc("mcp.upsert", { ...cfg, enabled: v })
                      load()
                    }}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm">
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => rpc("mcp.restart", { id: cfg.id })}>
                        <RotateCwIcon />
                        {t("mcp.reconnect")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditing(cfg)
                          setDialog(true)
                        }}
                      >
                        <PencilIcon />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={async () => {
                          await rpc("mcp.delete", { id: cfg.id })
                          load()
                        }}
                      >
                        <Trash2Icon />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CollapsibleContent>
                  <div className="border-t bg-muted/20 px-4 py-3 pl-14">
                    {st?.tools.length ? (
                      <ul className="grid gap-2">
                        {st.tools.map((t) => (
                          <li key={t.name}>
                            <div className="font-mono text-xs font-medium">{t.name}</div>
                            <div className="line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-xs text-muted-foreground">{st?.state === "connected" ? t("mcp.noTools") : t("mcp.toolsAfterConnect")}</div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      )}
      <ServerDialog open={dialog} server={editing} onClose={() => (setDialog(false), load())} />
      <ImportDialog open={importOpen} onClose={() => (setImportOpen(false), load())} />
    </Section>
  )
}
