// One row of the session list: its title (faded, not cut, when long), the status dot where the menu button
// sits, the row menu, and for forks the branch line under their source.
import { useEffect, useRef, useState } from "preact/hooks"
import { ArchiveIcon, ChevronDownIcon, CircleAlertIcon, DownloadIcon, FolderOpenIcon, GitMergeIcon, MoreHorizontalIcon, PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { rpc } from "@/lib/api"
import { relativeTime, shortPath } from "@/lib/format"
import { appInfo, route, unseen } from "@/lib/store"
import { isMobileApp } from "@/lib/platform"
import { downloadText } from "@/lib/download"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

/** Hover is a light wash in the secondary color; the selected row is a darker fill and full-strength text. */
export const rowClass =
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
export function FadeLabel({ text, className }: { text: string; className?: string }) {
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

/** Where a fork sits under its source: a line down the side, turning in at the last one. */
export const branchLine = {
  middle: "ml-[17px] pl-2.5 before:absolute before:top-0 before:left-0 before:h-[calc(100%+1px)] before:w-px before:bg-muted-foreground/25",
  last: "ml-[17px] pl-2.5 before:absolute before:top-0 before:left-0 before:h-1/2 before:w-2 before:rounded-bl-md before:border-b before:border-l before:border-muted-foreground/25",
}

export function SessionItem({
  s,
  active,
  parent,
  branch,
  folded,
  onToggleFold,
  onRename,
  onDelete,
  onMerge,
}: {
  s: SessionInfo
  active: boolean
  /** The session this one was forked from, when it is in the list. */
  parent?: SessionInfo
  /** Drawn as a fork under its source. */
  branch?: "middle" | "last"
  /** Set on a session with forks under it. */
  folded?: boolean
  onToggleFold?: () => void
  onRename: () => void
  onDelete: () => void
  onMerge: (target: SessionInfo | null) => void
}) {
  const status = s.status !== "idle" || unseen.value.has(s.id) ? <StatusDot status={s.status} unseen={unseen.value.has(s.id)} /> : null
  const title = s.title || (s.forkOf ? t("sidebar.branch") : t("common.untitled"))
  return (
    <SidebarMenuItem className={branch && branchLine[branch]}>
      <SidebarMenuButton
        isActive={active}
        onClick={() => (route.value = { name: "chat", sessionId: s.id })}
        className={rowClass}
        aria-expanded={onToggleFold ? !folded : undefined}
        title={`${title}\n${shortPath(s.cwd, appInfo.value?.home)}\n${relativeTime(s.updatedAt)}`}
      >
        <FadeLabel text={title} className={cn(onToggleFold && "flex-initial", !s.title && !active && "text-muted-foreground/70")} />
        {onToggleFold && (
          // Inside the row so the title and its fold control read as one; it only folds, never navigates.
          <span
            aria-hidden="true"
            className="-mx-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:size-8"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFold()
            }}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform", folded && "-rotate-90")} />
          </span>
        )}
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
          {parent && (
            <DropdownMenuItem onSelect={() => onMerge(parent)}>
              <GitMergeIcon />
              {t("sidebar.mergeToMain")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onMerge(null)}>
            <GitMergeIcon />
            {t("sidebar.mergeInto")}
          </DropdownMenuItem>
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
