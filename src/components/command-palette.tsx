import { useEffect, useState } from "preact/hooks"
import { BarChart3Icon, MessageSquareIcon, MoonIcon, PlugIcon, Settings2Icon, SquarePenIcon, SunIcon, TextSearchIcon, CpuIcon } from "lucide-react"
import type { SearchHit } from "@shared/protocol"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { rpc } from "@/lib/api"
import { basename, relativeTime } from "@/lib/format"
import { openSession, paletteOpen, route, sessions, settings, updateSettings } from "@/lib/store"
import { t } from "@/lib/i18n"

export function CommandPalette() {
  const open = paletteOpen.value
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(() => rpc<SearchHit[]>("sessions.search", { query: q, limit: 20 }).then(setHits).catch(() => setHits([])), 180)
    return () => clearTimeout(t)
  }, [query])

  const close = () => (paletteOpen.value = false)
  const go = (fn: () => void) => {
    fn()
    close()
  }
  const dark = settings.value?.theme === "dark" || (settings.value?.theme === "system" && document.documentElement.classList.contains("dark"))

  return (
    <CommandDialog open={open} onOpenChange={(o) => (paletteOpen.value = o)} title={t("palette.title")} description={t("palette.desc")} className="sm:max-w-xl">
      <Command shouldFilter={true}>
      <CommandInput placeholder={t("palette.placeholder")} value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        <CommandGroup heading={t("palette.actions")}>
          <CommandItem onSelect={() => go(() => (route.value = { name: "home" }))}>
            <SquarePenIcon />
            {t("nav.newSession")}
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "usage" }))}>
            <BarChart3Icon />
            {t("nav.usage")}
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings" }))}>
            <Settings2Icon />
            {t("nav.settings")}
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings", tab: "models" }))}>
            <CpuIcon />
            {t("palette.manageModels")}
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings", tab: "mcp" }))}>
            <PlugIcon />
            {t("palette.manageMcp")}
          </CommandItem>
          <CommandItem onSelect={() => go(() => updateSettings({ theme: dark ? "light" : "dark" }))}>
            {dark ? <SunIcon /> : <MoonIcon />}
            {dark ? t("palette.toLight") : t("palette.toDark")}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("palette.sessions")}>
          {sessions.value.slice(0, query ? 50 : 8).map((s) => (
            <CommandItem key={s.id} value={`${s.title} ${s.cwd} ${s.id}`} onSelect={() => go(() => openSession(s.id))}>
              <MessageSquareIcon />
              <span className="truncate">{s.title || t("common.untitled")}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {basename(s.cwd)} · {relativeTime(s.updatedAt)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {hits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("palette.messages")}>
              {hits.map((h, i) => (
                <CommandItem key={`${h.sessionId}-${h.seq}-${i}`} value={`hit ${query} ${h.sessionId} ${h.seq} ${i}`} onSelect={() => go(() => openSession(h.sessionId))}>
                  <TextSearchIcon />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-muted-foreground">{h.title || t("common.untitled")}</div>
                    <div className="truncate">
                      {h.snippet
                        .replace(/\s+/g, " ")
                        .split(/(«[^»]*»)/)
                        .map((part, j) =>
                          part.startsWith("«") ? (
                            <mark key={j} className="rounded bg-primary/15 px-0.5 text-foreground">
                              {part.slice(1, -1)}
                            </mark>
                          ) : (
                            part
                          ),
                        )}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
