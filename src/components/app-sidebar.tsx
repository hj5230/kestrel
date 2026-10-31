// The session list. Rows stay quiet: status sits where the menu button does, and a group label folds its sessions away.
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BarChart3Icon,
  CheckIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  LaptopIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
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
import { useEdgeSwipe } from "@/hooks/use-edge-swipe"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { RenameDialog, ConfirmDeleteDialog, ArchivedDialog } from "@/components/session-dialogs"
import { rpc } from "@/lib/api"
import { basename, dayBucket, dayBucketId, relativeTime, shortPath } from "@/lib/format"
import { addingMac, appInfo, connected, pairedMac, pairedMacs, paletteOpen, route, sessions, enabledModels, switchMac, unseen } from "@/lib/store"
import { isDesktopApp, isMobileApp } from "@/lib/platform"
import { downloadText } from "@/lib/download"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { lang, t } from "@/lib/i18n"

type GroupMode = "time" | "project"

function loadGroupMode(): GroupMode {
  try {
    return (localStorage.getItem("kestrel-group-mode") as GroupMode) || "time"
  } catch {
    return "time"
  }
}

const COLLAPSED_KEY = "kestrel-collapsed-groups"

function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((x) => typeof x === "string"))
  } catch {
    return new Set()
  }
}

function storeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
  } catch {}
}

/** Hover is a light wash in the secondary color; the selected row is a darker fill and full-strength text. */
const rowClass =
  "h-8 rounded-md px-2.5 font-normal text-[13px] text-muted-foreground hover:bg-sidebar-hover hover:text-muted-foreground data-active:bg-sidebar-accent data-active:font-normal data-active:text-sidebar-accent-foreground data-active:hover:bg-sidebar-accent data-active:hover:text-sidebar-accent-foreground"

/** Working: a gray dot that breathes. Needs an answer: yellow. Finished since last opened: blue. */
export function StatusDot({ status, unseen }: { status: SessionInfo["status"]; unseen?: boolean }) {
  if (status === "running") return <span className="size-1.5 animate-breathe rounded-full bg-muted-foreground" />
  if (status === "waiting") return <span className="size-1.5 rounded-full bg-warning" />
  if (status === "error") return <CircleAlertIcon className="size-3.5 text-destructive" />
  if (unseen) return <span className="size-1.5 rounded-full bg-info" />
  return null
}

/** Hard ellipsis eats the last glyph. Fade the end, and only once the line actually overflows. */
function FadeLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <div
      ref={ref}
      className={cn(
        "min-w-0 flex-1 overflow-hidden whitespace-nowrap",
        over &&
          "[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] group-hover/menu-item:[mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent_calc(100%-20px))] group-focus-within/menu-item:[mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent_calc(100%-20px))] pointer-coarse:[mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent_calc(100%-20px))]",
        className,
      )}
    >
      {text}
    </div>
  )
}

function SessionItem({ s, active, onRename, onDelete }: { s: SessionInfo; active: boolean; onRename: () => void; onDelete: () => void }) {
  const status = s.status !== "idle" || unseen.value.has(s.id) ? <StatusDot status={s.status} unseen={unseen.value.has(s.id)} /> : null
  const title = s.title || t("common.untitled")
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => (route.value = { name: "chat", sessionId: s.id })}
        className={rowClass}
        title={`${title}\n${shortPath(s.cwd, appInfo.value?.home)}\n${relativeTime(s.updatedAt)}`}
      >
        <FadeLabel text={title} className={!s.title && !active ? "text-muted-foreground/70" : undefined} />
      </SidebarMenuButton>
      {status && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-1 z-0 flex size-5 -translate-y-1/2 items-center justify-center group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0 group-has-data-[state=open]/menu-item:opacity-0 pointer-coarse:right-2.5"
        >
          {status}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* With a status dot the "…" replaces it on hover at every width; the kit only hides it from md up. */}
          <SidebarMenuAction showOnHover className={status ? "max-md:opacity-0 pointer-coarse:opacity-0" : undefined} aria-label={t("common.moreActions")}>
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
          {!isMobileApp && (
            <DropdownMenuItem onSelect={() => rpc("app.open", { path: s.cwd })}>
              <FolderOpenIcon />
              {t("sidebar.openFolder")}
            </DropdownMenuItem>
          )}
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

/** Mobile: which Mac is in use, with a menu to move to another paired Mac or add one. */
function MacSwitcher() {
  const { setOpenMobile } = useSidebar()
  const current = pairedMac.value
  if (!current) return null
  const macs = pairedMacs.value.length ? pairedMacs.value : [current]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t("sidebar.switchMac")} className="-my-1 flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 outline-none active:bg-sidebar-accent">
          <span className="truncate">{current.serverName}</span>
          <ChevronsUpDownIcon className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-52">
        <DropdownMenuLabel>{t("sidebar.switchMac")}</DropdownMenuLabel>
        {macs.map((m) => (
          <DropdownMenuItem
            key={m.deviceId}
            onSelect={() => {
              setOpenMobile(false)
              void switchMac(m.deviceId)
            }}
          >
            <LaptopIcon />
            <span className="truncate">{m.serverName}</span>
            {m.deviceId === current.deviceId && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setOpenMobile(false)
            addingMac.value = true
          }}
        >
          <PlusIcon />
          {t("connection.add")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebar() {
  const [groupMode, setGroupMode] = useState<GroupMode>(loadGroupMode)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [renaming, setRenaming] = useState<SessionInfo | null>(null)
  const [deleting, setDeleting] = useState<SessionInfo | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const r = route.value
  const activeId = r.name === "chat" ? r.sessionId : null
  const { setOpenMobile, openMobile, isMobile } = useSidebar()
  useEdgeSwipe(isMobile, openMobile, setOpenMobile)
  // On phones the sidebar is a drawer over the page: get out of the way once something is picked.
  useEffect(() => setOpenMobile(false), [JSON.stringify(r)])
  const list = sessions.value

  const groups = useMemo(() => {
    const pinned = list.filter((s) => s.pinned)
    const rest = list.filter((s) => !s.pinned)
    const home = appInfo.value?.home
    const out: { id: string; label: string; title: string; items: SessionInfo[] }[] = []
    if (pinned.length) {
      const label = t("sidebar.pinned")
      out.push({ id: "pinned", label, title: label, items: pinned })
    }
    const map = new Map<string, { id: string; label: string; title: string; items: SessionInfo[] }>()
    for (const s of rest) {
      const id = groupMode === "time" ? `time:${dayBucketId(s.updatedAt)}` : `project:${s.cwd}`
      let group = map.get(id)
      if (!group) {
        const label = groupMode === "time" ? dayBucket(s.updatedAt) : basename(s.cwd)
        const title = groupMode === "time" ? label : shortPath(s.cwd, home)
        group = { id, label, title, items: [] }
        map.set(id, group)
        out.push(group)
      }
      group.items.push(s)
    }
    return out
  }, [list, groupMode, lang.value])

  const setMode = (m: GroupMode) => {
    setGroupMode(m)
    try {
      localStorage.setItem("kestrel-group-mode", m)
    } catch {}
  }

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      storeCollapsed(next)
      return next
    })
  }

  const nav = [
    { key: "home", label: t("nav.newSession"), icon: PlusIcon, kbd: "⌘N", onClick: () => (route.value = { name: "home" }) },
    { key: "usage", label: t("nav.usage"), icon: BarChart3Icon, onClick: () => (route.value = { name: "usage" }) },
    { key: "settings", label: t("nav.settings"), icon: Settings2Icon, kbd: "⌘,", onClick: () => (route.value = { name: "settings" }) },
  ]

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader className="gap-1 pt-0">
        <div data-tauri-drag-region={isDesktopApp || undefined} className={cn("shrink-0", isMobileApp ? "h-[max(0.5rem,env(safe-area-inset-top))]" : "h-9")} />
        <SidebarMenu>
          {nav.map((n) => (
            <SidebarMenuItem key={n.key}>
              <SidebarMenuButton isActive={r.name === n.key} onClick={n.onClick} className={rowClass}>
                {n.key === "home" ? (
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-current">
                    <PlusIcon className="size-2.5!" />
                  </span>
                ) : (
                  <n.icon />
                )}
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                {n.kbd && (
                  <span className="ml-auto text-[11px] text-muted-foreground/70 opacity-0 group-hover/menu-item:opacity-100 pointer-coarse:hidden">{n.kbd}</span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {list.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t("sidebar.empty")}</div>
        )}
        {groups.map((g, i) => {
          const open = !collapsed.has(g.id)
          return (
            <SidebarGroup key={g.id} className={cn("px-2 pb-0.5", i === 0 ? "pt-2" : "pt-3")}>
              <div className="group/label flex items-center gap-0.5 pr-1">
                <button
                  type="button"
                  className="flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-normal text-muted-foreground outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-11"
                  aria-expanded={open}
                  title={g.title !== g.label ? g.title : undefined}
                  onClick={() => toggleGroup(g.id)}
                >
                  <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
                  <span className="truncate">{g.label}</span>
                </button>
                {i === 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title={t("sidebar.grouping")}
                        aria-label={t("sidebar.grouping")}
                        className="pointer-events-none flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/label:pointer-events-auto group-hover/label:opacity-100 hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:pointer-events-auto aria-expanded:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:size-10 pointer-coarse:opacity-100"
                      >
                        <FolderTreeIcon className="size-3.5" />
                      </button>
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
              </div>
              {open && (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-px">
                    {g.items.map((s) => (
                      <SessionItem key={s.id} s={s} active={s.id === activeId} onRename={() => setRenaming(s)} onDelete={() => setDeleting(s)} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1.5 px-1.5 text-xs">
          <span className={cn("size-1.5 shrink-0 rounded-full", connected.value ? "bg-success" : "bg-destructive")} />
          {isMobileApp && pairedMac.value ? (
            <MacSwitcher />
          ) : (
            <span className="shrink-0 text-sidebar-foreground/80">{connected.value ? t("sidebar.connected") : t("sidebar.connecting")}</span>
          )}
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="min-w-0 truncate text-muted-foreground">{t("sidebar.stats", { sessions: list.length, models: enabledModels.value.length })}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" aria-label={t("nav.search")} onClick={() => (paletteOpen.value = true)}>
                <SearchIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("nav.search")} <Kbd>⌘K</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
      <ArchivedDialog open={archivedOpen} onOpenChange={setArchivedOpen} />
    </Sidebar>
  )
}
