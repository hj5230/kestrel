import { useEffect, useState } from "preact/hooks"
import { BarChart3Icon, MessageSquareIcon, MoonIcon, PlugIcon, Settings2Icon, SquarePenIcon, SunIcon, TextSearchIcon, CpuIcon } from "lucide-react"
import type { SearchHit } from "@shared/protocol"
import {
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
    <CommandDialog open={open} onOpenChange={(o) => (paletteOpen.value = o)} title="搜索" description="搜索会话、消息与操作" className="sm:max-w-xl">
      <CommandInput placeholder="搜索会话、消息内容或操作…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="操作">
          <CommandItem onSelect={() => go(() => (route.value = { name: "home" }))}>
            <SquarePenIcon />
            新会话
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "usage" }))}>
            <BarChart3Icon />
            用量统计
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings" }))}>
            <Settings2Icon />
            设置
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings", tab: "models" }))}>
            <CpuIcon />
            管理模型供应商
          </CommandItem>
          <CommandItem onSelect={() => go(() => (route.value = { name: "settings", tab: "mcp" }))}>
            <PlugIcon />
            管理 MCP 服务
          </CommandItem>
          <CommandItem onSelect={() => go(() => updateSettings({ theme: dark ? "light" : "dark" }))}>
            {dark ? <SunIcon /> : <MoonIcon />}
            切换到{dark ? "浅色" : "深色"}主题
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="会话">
          {sessions.value.slice(0, query ? 50 : 8).map((s) => (
            <CommandItem key={s.id} value={`${s.title} ${s.cwd} ${s.id}`} onSelect={() => go(() => openSession(s.id))}>
              <MessageSquareIcon />
              <span className="truncate">{s.title || "新会话"}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {basename(s.cwd)} · {relativeTime(s.updatedAt)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {hits.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="消息内容">
              {hits.map((h, i) => (
                <CommandItem key={`${h.sessionId}-${h.seq}-${i}`} value={`hit ${query} ${h.sessionId} ${h.seq} ${i}`} onSelect={() => go(() => openSession(h.sessionId))}>
                  <TextSearchIcon />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-muted-foreground">{h.title || "新会话"}</div>
                    <div className="truncate">{h.snippet.replace(/\s+/g, " ")}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
