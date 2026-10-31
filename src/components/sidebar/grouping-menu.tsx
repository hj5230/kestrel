// The control on the first group's label: group by day or by folder, and open the archive.
import { ArchiveRestoreIcon, FolderTreeIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { t } from "@/lib/i18n"
import type { GroupMode } from "./prefs"

export function GroupingMenu({ mode, onMode, onArchived }: { mode: GroupMode; onMode: (m: GroupMode) => void; onArchived: () => void }) {
  return (
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
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onMode(v as GroupMode)}>
          <DropdownMenuRadioItem value="time">{t("sidebar.byTime")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="project">{t("sidebar.byProject")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchived}>
          <ArchiveRestoreIcon />
          {t("sidebar.archived")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
