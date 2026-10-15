import { useMemo, useState } from "preact/hooks"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BarChart3Icon,
  CircleAlertIcon,
  DownloadIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Settings2Icon,
  ShipWheelIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { RenameDialog, ConfirmDeleteDialog, ArchivedDialog } from "@/components/session-dialogs"
import { rpc } from "@/lib/api"
import { basename, dayBucket, relativeTime, shortPath } from "@/lib/format"
import { appInfo, connected, paletteOpen, route, sessions, enabledModels } from "@/lib/store"
import { downloadText } from "@/lib/download"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { lang, t } from "@/lib/i18n"

type GroupMode = "time" | "project"

function loadGroupMode(): GroupMode {
  try {
    return (localStorage.getItem("helm-group-mode") as GroupMode) || "time"
  } catch {
    return "time"
  }
}

export function StatusDot({ status }: { status: SessionInfo["status"] }) {
  if (status === "running") return <Spinner className="size-3.5 text-muted-foreground" />
  if (status === "waiting") return <span className="size-2 rounded-full bg-warning ring-3 ring-warning/20" />
  if (status === "error") return <CircleAlertIcon className="size-3.5 text-destructive" />
  return null
}

function SessionItem({ s, active, onRename, onDelete }: { s: SessionInfo; active: boolean; onRename: () => void; onDelete: () => void }) {
  const status = s.status !== "idle" ? <StatusDot status={s.status} /> : null
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => (route.value = { name: "chat", sessionId: s.id })}
        className="h-8 gap-2 pr-8"
        title={`${s.title || t("common.untitled")}\n${shortPath(s.cwd, appInfo.value?.home)}`}
      >
        {status && <span className="flex size-4 shrink-0 items-center justify-center">{status}</span>}
        <span className={cn("truncate", !s.title && "text-muted-foreground")}>{s.title || t("common.untitled")}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70 tabular-nums group-hover/menu-item:opacity-0">
          {relativeTime(s.updatedAt)}
        </span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontalIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-48">
          <DropdownMenuItem onSelect={onRename}>
            <PencilIcon />
            {t("common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rpc("sessions.update", { id: s.id, patch: { pinned: !s.pinned } })}>
            {s.pinned ? <PinOffIcon /> : <PinIcon />}
            {s.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              const md = await rpc<string>("sessions.export", { id: s.id })
              downloadText(`${s.title || "session"}.md`, md)
            }}
          >
            <DownloadIcon />
            {t("sidebar.exportMd")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => rpc("app.open", { path: s.cwd })}>
            <FolderOpenIcon />
            {t("sidebar.openFolder")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={async () => {
              await rpc("sessions.update", { id: s.id, patch: { archived: true } })
              if (route.value.name === "chat" && route.value.sessionId === s.id) route.value = { name: "home" }
              toast.success(t("sidebar.archivedToast"))
            }}
          >
            <ArchiveIcon />
            {t("sidebar.archive")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const [groupMode, setGroupMode] = useState<GroupMode>(loadGroupMode)
  const [renaming, setRenaming] = useState<SessionInfo | null>(null)
  const [deleting, setDeleting] = useState<SessionInfo | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const r = route.value
  const activeId = r.name === "chat" ? r.sessionId : null
  const list = sessions.value

  const groups = useMemo(() => {
    const pinned = list.filter((s) => s.pinned)
    const rest = list.filter((s) => !s.pinned)
    const out: { label: string; items: SessionInfo[] }[] = []
    if (pinned.length) out.push({ label: t("sidebar.pinned"), items: pinned })
    const map = new Map<string, SessionInfo[]>()
    for (const s of rest) {
      const key = groupMode === "time" ? dayBucket(s.updatedAt) : s.cwd
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    for (const [key, items] of map) {
      out.push({ label: groupMode === "time" ? key : basename(key), items })
    }
    return out
  }, [list, groupMode, lang.value])

  const setMode = (m: GroupMode) => {
    setGroupMode(m)
    try {
      localStorage.setItem("helm-group-mode", m)
    } catch {}
  }

  const nav = [
    { key: "home", label: t("nav.newSession"), icon: SquarePenIcon, kbd: "⌘N", onClick: () => (route.value = { name: "home" }) },
    { key: "usage", label: t("nav.usage"), icon: BarChart3Icon, onClick: () => (route.value = { name: "usage" }) },
    { key: "settings", label: t("nav.settings"), icon: Settings2Icon, kbd: "⌘,", onClick: () => (route.value = { name: "settings" }) },
  ]

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader className="gap-3 pt-0">
        <div data-tauri-drag-region className="drag-region h-9 shrink-0" />
        <div className="flex items-center gap-2 px-1.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ShipWheelIcon className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">Helm</span>
          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => (paletteOpen.value = true)}>
                  <SearchIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("nav.search")} <Kbd>⌘K</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <SidebarMenu>
          {nav.map((n) => (
            <SidebarMenuItem key={n.key}>
              <SidebarMenuButton isActive={r.name === n.key} onClick={n.onClick}>
                <n.icon />
                <span>{n.label}</span>
                {n.kbd && <span className="ml-auto text-[11px] text-muted-foreground/70">{n.kbd}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {list.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t("sidebar.empty")}</div>
        )}
        {groups.map((g, i) => (
          <SidebarGroup key={g.label + i} className="py-1">
            <SidebarGroupLabel className="truncate" title={g.label}>
              {g.label}
            </SidebarGroupLabel>
            {i === 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarGroupAction title={t("sidebar.grouping")}>
                    <FolderTreeIcon />
                  </SidebarGroupAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>{t("sidebar.groupSessions")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={groupMode} onValueChange={(v) => setMode(v as GroupMode)}>
                    <DropdownMenuRadioItem value="time">{t("sidebar.byTime")}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="project">{t("sidebar.byProject")}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setArchivedOpen(true)}>
                    <ArchiveRestoreIcon />
                    {t("sidebar.archived")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {g.items.map((s) => (
                  <SessionItem key={s.id} s={s} active={s.id === activeId} onRename={() => setRenaming(s)} onDelete={() => setDeleting(s)} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", connected.value ? "bg-success" : "bg-destructive")} />
          <span>{connected.value ? t("sidebar.connected") : t("sidebar.connecting")}</span>
          <span className="ml-auto flex items-center gap-1">
            <HistoryIcon className="size-3" />
            {t("sidebar.stats", { sessions: list.length, models: enabledModels.value.length })}
          </span>
        </div>
      </SidebarFooter>
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
      <ArchivedDialog open={archivedOpen} onOpenChange={setArchivedOpen} />
    </Sidebar>
  )
}
