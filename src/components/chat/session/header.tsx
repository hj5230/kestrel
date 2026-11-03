// The conversation's header: title (click to rename), working folder menu, context meter and "…".
import { FolderIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react"
import type { ModelConfig, SessionInfo } from "@shared/protocol"
import { ActionMenu, type MenuNode } from "@/components/action-menu"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { shortPath } from "@/lib/format"
import { appInfo } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { ContextMeter } from "../context-meter"

export function ChatHeader({
  s,
  model,
  compacting,
  onCompact,
  onRename,
  folderMenu,
  sessionMenu,
}: {
  s: SessionInfo
  model?: ModelConfig
  compacting: boolean
  onCompact: () => void
  onRename: () => void
  folderMenu: MenuNode[]
  sessionMenu: MenuNode[]
}) {
  return (
    <PageHeader>
      <button type="button" onClick={onRename} className="group/title flex min-w-0 max-w-[55%] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted pointer-coarse:min-h-10">
        <span className={cn("truncate text-sm font-medium", !s.title && "text-muted-foreground")}>{s.title || t("common.untitled")}</span>
        <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100" />
      </button>
      <ActionMenu
        title={t("chat.folder")}
        align="start"
        anchorClassName="min-w-0 shrink"
        nodes={folderMenu}
        trigger={
          <button
            type="button"
            aria-label={t("chat.folder")}
            className="flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted pointer-coarse:min-h-10"
          >
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="truncate font-mono max-sm:hidden">{shortPath(s.cwd, appInfo.value?.home)}</span>
          </button>
        }
      />
      <div className="ml-auto flex items-center gap-1">
        <ContextMeter session={s} model={model} onCompact={onCompact} compacting={compacting} />
        <ActionMenu
          title={t("common.moreActions")}
          nodes={sessionMenu}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
              <MoreHorizontalIcon />
            </Button>
          }
        />
      </div>
    </PageHeader>
  )
}
