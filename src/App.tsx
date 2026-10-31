import { useEffect } from "preact/hooks"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandPalette } from "@/components/command-palette"
import { BootScreen } from "@/components/boot-screen"
import { PairScreen } from "@/components/pair-screen"
import { ErrorBoundary } from "@/components/error-boundary"
import { IslandKestrel } from "@/components/island-kestrel"
import { ChatView } from "@/components/chat/chat-view"
import { HomeView } from "@/pages/home"
import { UsagePage } from "@/pages/usage"
import { SettingsPage } from "@/pages/settings"
import { isMobileApp, isPhoneShell } from "@/lib/platform"
import { addingMac, bootError, deviceRevoked, pairedMac, paletteOpen, route, settings } from "@/lib/store"

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === "k") {
        e.preventDefault()
        paletteOpen.value = !paletteOpen.value
      } else if (e.key === "n") {
        e.preventDefault()
        route.value = { name: "home" }
      } else if (e.key === ",") {
        e.preventDefault()
        route.value = { name: "settings" }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

function Main() {
  const r = route.value
  if (r.name === "chat") return <ChatView key={r.sessionId} sessionId={r.sessionId} />
  if (r.name === "usage") return <UsagePage />
  if (r.name === "settings") return <SettingsPage tab={r.tab} />
  return <HomeView />
}

export default function App() {
  useShortcuts()
  const s = settings.value
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  if (isMobileApp && (pairedMac.value === null || deviceRevoked.value || addingMac.value)) return <PairScreen />
  if (!s || bootError.value) return <BootScreen error={bootError.value} />
  return (
    <TooltipProvider delayDuration={400}>
      <SidebarProvider style={{ "--sidebar-width": "17rem" } as any} className="h-full min-h-0">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <ErrorBoundary resetKey={JSON.stringify(route.value)}>
            <Main />
          </ErrorBoundary>
        </SidebarInset>
      </SidebarProvider>
      <ErrorBoundary compact resetKey={paletteOpen.value}>
        <CommandPalette />
      </ErrorBoundary>
      {isPhoneShell && <IslandKestrel />}
      {/* Sonner's top offset ignores the notch and Dynamic Island; start below the safe area on the phone. */}
      <Toaster
        theme={dark ? "dark" : "light"}
        position={isPhoneShell ? "top-center" : "bottom-right"}
        mobileOffset={isPhoneShell ? { top: "calc(var(--inset-top) + 8px)" } : undefined}
        offset={isPhoneShell ? { top: "calc(var(--inset-top) + 8px)" } : undefined}
      />
    </TooltipProvider>
  )
}
