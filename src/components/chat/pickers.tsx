import { useEffect, useState } from "preact/hooks"
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FolderIcon,
  FolderOpenIcon,
  ListChecksIcon,
  ShieldCheckIcon,
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
import { rpc } from "@/lib/api"
import { isDesktopApp } from "@/lib/platform"
import { pickDirectory } from "@/lib/download"
import { basename, formatTokens, shortPath } from "@/lib/format"
import { appInfo, enabledModels, findModel, providers, route } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

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
          <span className="truncate">{current?.name ?? (modelId || t("picker.selectModel"))}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("picker.searchModels")} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t("picker.noModels")}</CommandEmpty>
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
                        {m.id} · {t("picker.context", { n: formatTokens(m.contextWindow) })}
                        {m.reasoning ? ` · ${t("picker.reasoning")}` : ""}
                        {m.vision ? ` · ${t("picker.vision")}` : ""}
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
                {t("picker.manage")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

export function ThinkingPicker({ value, onChange }: { value: ThinkingLevel; onChange: (v: ThinkingLevel) => void }) {
  const label = t(`thinking.${value}` as MessageKey)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground hover:text-foreground" title={t("picker.thinking")}>
          <BrainIcon />
          <span>{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>{t("picker.thinking")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ThinkingLevel)}>
          {THINKING.map((v) => (
            <DropdownMenuRadioItem key={v} value={v}>
              {t(`thinking.${v}` as MessageKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function permissionModes(): { value: PermissionMode; label: string; desc: string; icon: any }[] {
  return [
    { value: "manual", label: t("perm.manual"), desc: t("perm.manual.desc"), icon: ShieldCheckIcon },
    { value: "acceptEdits", label: t("perm.acceptEdits"), desc: t("perm.acceptEdits.desc"), icon: FilePenLineIcon },
    { value: "whitelist", label: t("perm.whitelist"), desc: t("perm.whitelist.desc"), icon: ListChecksIcon },
    { value: "bypass", label: t("perm.bypass"), desc: t("perm.bypass.desc"), icon: ShieldOffIcon },
  ]
}

export function PermissionPicker({ value, onChange }: { value: PermissionMode; onChange: (v: PermissionMode) => void }) {
  const modes = permissionModes()
  const cur = modes.find((m) => m.value === value) ?? modes[2]
  const Icon = cur.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1 px-2 text-muted-foreground hover:text-foreground",
            value === "bypass" && "text-destructive hover:text-destructive",
          )}
        >
          <Icon />
          <span>{cur.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("picker.permission")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
          {modes.map((m) => (
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
          <CommandInput placeholder={t("picker.pathPlaceholder")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80">
            {query && (
              <CommandGroup heading={t("picker.useTyped")}>
                <CommandItem value={`__typed ${query}`} onSelect={() => choose(query)}>
                  <FolderOpenIcon />
                  <span className="truncate font-mono text-xs">{query}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {suggest.length > 0 && (
              <CommandGroup heading={t("picker.subdirs")}>
                {suggest.map((d) => (
                  <CommandItem key={d} value={`s ${d}`} onSelect={() => setQuery(d + "/")}>
                    <FolderIcon />
                    <span className="truncate font-mono text-xs">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!query && recent.length > 0 && (
              <CommandGroup heading={t("picker.recent")}>
                {recent.map((d) => (
                  <CommandItem key={d} value={`r ${d}`} onSelect={() => choose(d)}>
                    <FolderIcon />
                    <span className="truncate">{basename(d)}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isDesktopApp && (
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
                    {t("picker.browse")}
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
