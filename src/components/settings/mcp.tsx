import { useEffect, useState } from "preact/hooks"
import { ChevronRightIcon, FileJsonIcon, MoreHorizontalIcon, PencilIcon, PlugIcon, PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react"
import type { McpServerConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Section } from "./layout"
import { rpc } from "@/lib/api"
import { mcpServers } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"
import { ServerDialog, ImportDialog } from "./mcp-dialogs"

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
                      <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
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
