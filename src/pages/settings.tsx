import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { BookTextIcon, BoxesIcon, BrainIcon, HistoryIcon, InfoIcon, LaptopIcon, PaletteIcon, PlugIcon, SearchIcon, ShieldCheckIcon, ShrinkIcon, SmartphoneIcon, SparklesIcon, TerminalSquareIcon, XIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/page-header"
import { ModelsSettings } from "@/components/settings/models"
import { McpSettings } from "@/components/settings/mcp"
import { HistorySettings, MemorySettings } from "@/components/settings/memory"
import { MobileSettings } from "@/components/settings/mobile"
import { ConnectionSettings } from "@/components/settings/connection"
import { searchSettings } from "@/components/settings/search"
import { t, type MessageKey } from "@/lib/i18n"
import { route, settings } from "@/lib/store"
import { isMobileApp } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { About } from "../components/settings/about"
import { Automation } from "../components/settings/automation"
import { Execution } from "../components/settings/execution"
import { General } from "../components/settings/general"
import { Permissions } from "../components/settings/permissions"
import { Skills, Instructions } from "../components/settings/skills"

const TABS = [
  { key: "general", icon: PaletteIcon },
  { key: "execution", icon: TerminalSquareIcon },
  { key: "automation", icon: ShrinkIcon },
  { key: "models", icon: BoxesIcon },
  { key: "mcp", icon: PlugIcon },
  { key: "skills", icon: SparklesIcon },
  { key: "instructions", icon: BookTextIcon },
  { key: "memory", icon: BrainIcon },
  { key: "history", icon: HistoryIcon },
  { key: "permissions", icon: ShieldCheckIcon },
  // Pairing phones is managed on the Mac; the phone shows which Mac it drives instead.
  ...(!isMobileApp ? [{ key: "mobile", icon: SmartphoneIcon }] : []),
  ...(isMobileApp ? [{ key: "connection", icon: LaptopIcon }] : []),
  { key: "about", icon: InfoIcon },
]

export function SettingsPage({ tab }: { tab?: string }) {
  const current = tab ?? "general"
  const s = settings.value!
  // On phones the tabs are a sideways strip: keep the selected one in view.
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" }), [current])
  const [query, setQuery] = useState("")
  const hits = useMemo(() => searchSettings(query, TABS.map((tb) => tb.key)), [query])
  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <span className="text-sm font-medium">{t("settings.title")}</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="shrink-0 border-b md:w-52 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="px-2 pt-2 md:px-3 md:pt-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                aria-label={t("settings.search")}
                placeholder={t("settings.search")}
                className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("")
                  if (e.key === "Enter" && hits[0]) {
                    route.value = { name: "settings", tab: hits[0].tab }
                    setQuery("")
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("common.clear")}
                  className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:size-9"
                  onClick={() => setQuery("")}
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          {query ? (
            <div className="grid max-h-[50vh] gap-0.5 overflow-y-auto p-2 md:max-h-none md:p-3">
              {hits.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">{t("settings.noResults")}</div>}
              {hits.map((h) => (
                <button
                  key={`${h.tab}:${h.label}`}
                  type="button"
                  className="grid rounded-lg px-2.5 py-1.5 text-left hover:bg-muted/60 pointer-coarse:min-h-11"
                  onClick={() => {
                    route.value = { name: "settings", tab: h.tab }
                    setQuery("")
                  }}
                >
                  <span className="truncate text-sm">{h.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{t(`settings.tab.${h.tab}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          ) : (
          <div className="flex gap-0.5 overflow-x-auto p-2 [scrollbar-width:none] md:grid md:p-3 [&::-webkit-scrollbar]:hidden">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                ref={current === tb.key ? activeTab : undefined}
                type="button"
                onClick={() => (route.value = { name: "settings", tab: tb.key })}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors pointer-coarse:min-h-10",
                  current === tb.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <tb.icon className="size-4" />
                {t(`settings.tab.${tb.key}` as MessageKey)}
              </button>
            ))}
          </div>
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 pb-[max(1.5rem,var(--inset-bottom))] md:px-8 md:py-8">
            {current === "general" && <General s={s} />}
            {current === "execution" && <Execution s={s} />}
            {current === "automation" && <Automation s={s} />}
            {current === "history" && <HistorySettings s={s} />}
            {current === "models" && <ModelsSettings />}
            {current === "mcp" && <McpSettings />}
            {current === "skills" && <Skills s={s} />}
            {current === "instructions" && <Instructions s={s} />}
            {current === "memory" && <MemorySettings s={s} />}
            {current === "permissions" && <Permissions s={s} />}
            {current === "mobile" && <MobileSettings />}
            {current === "connection" && <ConnectionSettings />}
            {current === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  )
}
