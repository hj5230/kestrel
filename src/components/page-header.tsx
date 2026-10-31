import type { ComponentChildren } from "preact"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { isDesktopApp } from "@/lib/platform"
import { cn } from "@/lib/utils"

/**
 * Top bar shared by every page: the sidebar toggle followed by page-specific content.
 * On desktop it doubles as the window's drag handle and leaves room for the traffic lights while
 * the sidebar is collapsed; on phones it extends under the status bar.
 */
export function PageHeader({ children, bordered = true, className }: { children?: ComponentChildren; bordered?: boolean; className?: string }) {
  const { state } = useSidebar()
  return (
    <header
      data-tauri-drag-region={isDesktopApp || undefined}
      className={cn(
        "flex h-[calc(3rem+var(--inset-top))] shrink-0 items-center gap-2 px-3 pt-[var(--inset-top)]",
        bordered && "border-b",
        isDesktopApp && state === "collapsed" && "pl-20",
        className,
      )}
    >
      <SidebarTrigger className="text-muted-foreground" />
      {children}
    </header>
  )
}
