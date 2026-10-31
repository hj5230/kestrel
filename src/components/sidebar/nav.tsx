// The sidebar's top: new session, usage and settings, under the window's drag area (or the status bar on phones).
import { BarChart3Icon, PlusIcon, Settings2Icon } from "lucide-react"
import { SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { route } from "@/lib/store"
import { isDesktopApp, isPhoneShell } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { rowClass } from "./session-item"

export function SidebarNav() {
  const r = route.value
  const nav = [
    { key: "home", label: t("nav.newSession"), icon: PlusIcon, kbd: "⌘N", onClick: () => (route.value = { name: "home" }) },
    { key: "usage", label: t("nav.usage"), icon: BarChart3Icon, onClick: () => (route.value = { name: "usage" }) },
    { key: "settings", label: t("nav.settings"), icon: Settings2Icon, kbd: "⌘,", onClick: () => (route.value = { name: "settings" }) },
  ]
  return (
    <SidebarHeader className="gap-1 pt-0">
      <div data-tauri-drag-region={isDesktopApp || undefined} className={cn("shrink-0", isPhoneShell ? "h-[max(0.5rem,var(--inset-top))]" : "h-9")} />
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
              {n.kbd && <span className="ml-auto text-[11px] text-muted-foreground/70 opacity-0 group-hover/menu-item:opacity-100 pointer-coarse:hidden">{n.kbd}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarHeader>
  )
}
