import { useEffect, useState } from "preact/hooks"
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  FilePenLineIcon,
  FolderIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
  Settings2Icon,
  EyeIcon,
} from "lucide-react"
import type { PermissionMode, ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { rpc, isTauri } from "@/lib/api"
import { pickDirectory } from "@/lib/download"
import { basename, formatTokens, shortPath } from "@/lib/format"
import { appInfo, enabledModels, findModel, providers, route } from "@/lib/store"
import { cn } from "@/lib/utils"

export function ModelPicker({
  providerId,
  modelId,
  onChange,
}: {
  providerId: string
  modelId: string
  onChange: (providerId: string, modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = findModel(providerId, modelId)
  const groups = providers.value
    .filter((p) => p.enabled)
    .map((p) => ({ p, models: enabledModels.value.filter((m) => m.providerId === p.id) }))
    .filter((g) => g.models.length)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-56 gap-1 px-2 text-muted-foreground hover:text-foreground">
          <span className="truncate">{current?.name ?? (modelId || "选择模型")}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索模型…" />
          <CommandList className="max-h-80">
            <CommandEmpty>没有可用的模型</CommandEmpty>
            {groups.map(({ p, models }) => (
              <CommandGroup key={p.id} heading={p.name}>
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${p.name} ${m.name} ${m.id}`}
                    onSelect={() => {
                      onChange(m.providerId, m.id)
                      setOpen(false)
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{m.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {m.id} · {formatTokens(m.contextWindow)} 上下文{m.reasoning ? " · 推理" : ""}
                        {m.vision ? " · 视觉" : ""}
                      </div>
                    </div>
                    {m.providerId === providerId && m.id === modelId && <CheckIcon className="size-4" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setOpen(false)
                  route.value = { name: "settings", tab: "models" }
                }}
              >
                <Settings2Icon />
                管理供应商与模型
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const THINKING: { value: ThinkingLevel; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "minimal", label: "最少" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
]

export function ThinkingPicker({ value, onChange }: { value: ThinkingLevel; onChange: (v: ThinkingLevel) => void }) {
  const label = THINKING.find((t) => t.value === value)?.label ?? value
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground hover:text-foreground" title="推理强度">
          <BrainIcon />
          <span>{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>推理强度</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ThinkingLevel)}>
          {THINKING.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const PERMISSION_MODES: { value: PermissionMode; label: string; desc: string; icon: any }[] = [
  { value: "default", label: "逐项确认", desc: "修改文件和执行命令前询问", icon: ShieldCheckIcon },
  { value: "acceptEdits", label: "自动编辑", desc: "自动接受文件修改，命令仍需确认", icon: FilePenLineIcon },
  { value: "plan", label: "只读规划", desc: "只读探索并给出计划，不修改文件", icon: ClipboardListIcon },
  { value: "bypass", label: "完全放行", desc: "所有操作不再询问（谨慎使用）", icon: ShieldOffIcon },
]

export function PermissionPicker({ value, onChange }: { value: PermissionMode; onChange: (v: PermissionMode) => void }) {
  const cur = PERMISSION_MODES.find((m) => m.value === value) ?? PERMISSION_MODES[0]
  const Icon = cur.icon ?? ShieldIcon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1 px-2 text-muted-foreground hover:text-foreground",
            value === "bypass" && "text-destructive hover:text-destructive",
            value === "plan" && "text-primary hover:text-primary",
          )}
        >
          <Icon />
          <span>{cur.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>权限模式</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
          {PERMISSION_MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value} className="items-start py-1.5">
              <div>
                <div>{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.desc}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CwdPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const [suggest, setSuggest] = useState<string[]>([])
  const home = appInfo.value?.home
  useEffect(() => {
    if (open) rpc<string[]>("fs.recentDirs").then(setRecent)
  }, [open])
  useEffect(() => {
    if (!query.includes("/") && !query.startsWith("~")) {
      setSuggest([])
      return
    }
    const t = setTimeout(() => rpc<string[]>("fs.dirs", { path: query }).then(setSuggest), 120)
    return () => clearTimeout(t)
  }, [query])
  const choose = (p: string) => {
    onChange(p)
    setOpen(false)
    setQuery("")
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-60 gap-1 px-2 text-muted-foreground hover:text-foreground" title={value}>
          <FolderIcon />
          <span className="truncate">{basename(value) || "~"}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="输入路径，如 ~/Code/project" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80">
            {query && (
              <CommandGroup heading="使用输入的路径">
                <CommandItem value={`__typed ${query}`} onSelect={() => choose(query)}>
                  <FolderOpenIcon />
                  <span className="truncate font-mono text-xs">{query}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {suggest.length > 0 && (
              <CommandGroup heading="子目录">
                {suggest.map((d) => (
                  <CommandItem key={d} value={`s ${d}`} onSelect={() => setQuery(d + "/")}>
                    <FolderIcon />
                    <span className="truncate font-mono text-xs">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!query && recent.length > 0 && (
              <CommandGroup heading="最近使用">
                {recent.map((d) => (
                  <CommandItem key={d} value={`r ${d}`} onSelect={() => choose(d)}>
                    <FolderIcon />
                    <span className="truncate">{basename(d)}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isTauri && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__browse"
                    onSelect={async () => {
                      const dir = await pickDirectory(value)
                      if (dir) choose(shortPath(dir, home))
                    }}
                  >
                    <EyeIcon />
                    浏览文件夹…
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
