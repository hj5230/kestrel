// The sidebar's bottom line: connection state (or, on phones, which Mac), counts, and search.
import { SearchIcon } from "lucide-react"
import { SidebarFooter } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { connected, enabledModels, pairedMac, paletteOpen, sessions } from "@/lib/store"
import { isMobileApp } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { MacSwitcher } from "./mac-switcher"

export function SidebarStatus() {
  return (
    <SidebarFooter className="pb-[max(0.5rem,var(--inset-bottom))]">
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
        <span className="min-w-0 truncate text-muted-foreground">{t("sidebar.stats", { sessions: sessions.value.length, models: enabledModels.value.length })}</span>
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
  )
}
