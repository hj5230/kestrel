import type { ComponentChildren } from "preact"
import { useEffect, useState } from "preact/hooks"
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  FilePenLineIcon,
  FolderIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  SparklesIcon,
  Settings2Icon,
  EyeIcon,
} from "lucide-react"
import type { PermissionMode, ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
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
import { isDesktopApp, isTouch } from "@/lib/platform"
import { pickDirectory } from "@/lib/download"
import { basename, formatTokens, shortPath } from "@/lib/format"
import { appInfo, enabledModels, findModel, providers, route } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

function ModelList({
  providerId,
  modelId,
  onChange,
}: {
  providerId: string
  modelId: string
  onChange: (providerId: string, modelId: string) => void
}) {
  const groups = providers.value
    .filter((p) => p.enabled)
    .map((p) => ({ p, models: enabledModels.value.filter((m) => m.providerId === p.id) }))
    .filter((g) => g.models.length)
  return (
    <Command>
      <CommandInput placeholder={t("picker.searchModels")} />
      <CommandList className="max-h-80" onTouchMove={blurOnScroll}>
        <CommandEmpty>{t("picker.noModels")}</CommandEmpty>
        {groups.map(({ p, models }) => (
          <CommandGroup key={p.id} heading={p.name}>
            {models.map((m) => (
              <CommandItem
                key={m.id}
                value={`${p.name} ${m.name} ${m.id}`}
                onSelect={() => onChange(m.providerId, m.id)}
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
          <CommandItem onSelect={() => onChange("", "")}>
            <Settings2Icon />
            {t("picker.manage")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/** A popover on desktop, a bottom sheet on touch, where a floating panel ends up behind the keyboard.
 *  The sheet rides on top of the keyboard (--kb) and never grabs focus on open, so the keyboard only
 *  appears when the search field is tapped. */
export function Panel({
  open,
  onOpenChange,
  align = "start",
  side,
  popoverClassName = "w-80 p-0",
  sheetClassName = "p-0",
  trigger,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: "start" | "end"
  side?: "top" | "bottom"
  popoverClassName?: string
  sheetClassName?: string
  trigger: ComponentChildren
  children: ComponentChildren
}) {
  if (isTouch) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ bottom: "var(--kb, 0px)", maxHeight: "min(75vh, calc(var(--app-height, 100vh) - 24px))" }}
          className={cn("gap-0 overflow-y-auto overscroll-contain rounded-t-2xl", "[html.keyboard-open_&]:pb-0", sheetClassName)}
        >
          {children}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={popoverClassName} align={align} side={side}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** Scrolling a list is how people dismiss the keyboard on iOS; the search field keeps focus otherwise. */
const blurOnScroll = () => {
  const el = document.activeElement
  if (el instanceof HTMLElement && el.matches("input, textarea")) el.blur()
}

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
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm" className="max-w-56 gap-1 px-2 text-muted-foreground hover:text-foreground">
          <span className="truncate">{current?.name ?? (modelId || t("picker.selectModel"))}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      }
    >
      <ModelList
        providerId={providerId}
        modelId={modelId}
        onChange={(p, m) => {
          setOpen(false)
          if (!p) route.value = { name: "settings", tab: "models" }
          else onChange(p, m)
        }}
      />
    </Panel>
  )
}

const THINKING: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"]

/** The model and its reasoning effort as one button. The effort only shows for a model that supports it. */
export function ModelControl({
  providerId,
  modelId,
  onChange,
  thinking,
  onThinking,
}: {
  providerId: string
  modelId: string
  onChange: (providerId: string, modelId: string) => void
  thinking: ThinkingLevel | null
  onThinking: (v: ThinkingLevel) => void
}) {
  const [open, setOpen] = useState(false)
  const current = findModel(providerId, modelId)
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button variant="ghost" size="sm" className="max-w-[42vw] gap-1 px-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10 sm:max-w-56">
          <span className="truncate">{current?.name ?? (modelId || t("picker.selectModel"))}</span>
          {thinking && (
            <>
              <span className="hidden shrink-0 sm:inline">· {t(`thinking.${thinking}` as MessageKey)}</span>
              <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70 sm:hidden" />
            </>
          )}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      }
    >
      <ModelList
        providerId={providerId}
        modelId={modelId}
        onChange={(p, m) => {
          setOpen(false)
          if (!p) route.value = { name: "settings", tab: "models" }
          else onChange(p, m)
        }}
      />
      {thinking && (
        <div className="border-t p-2.5">
          <div className="mb-1.5 text-xs text-muted-foreground">{t("picker.thinking")}</div>
          <div className="flex flex-wrap gap-1">
            {THINKING.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  onThinking(v)
                  setOpen(false)
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-xs pointer-coarse:min-h-10",
                  v === thinking ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`thinking.${v}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

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
    { value: "auto", label: t("perm.auto"), desc: t("perm.auto.desc"), icon: SparklesIcon },
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
            "gap-1 px-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10",
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

/** The folder browser itself, so it can sit inside another panel instead of its own popover. */
export function CwdBrowser({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone?: () => void }) {
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const [suggest, setSuggest] = useState<string[]>([])
  const home = appInfo.value?.home
  useEffect(() => {
    rpc<string[]>("fs.recentDirs").then(setRecent)
  }, [])
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
    setQuery("")
    onDone?.()
  }
  return (
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("picker.pathPlaceholder")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80" onTouchMove={blurOnScroll}>
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
  )
}

export function CwdPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title={value} className="max-w-60 gap-1 px-2 text-muted-foreground hover:text-foreground">
          <FolderIcon />
          <span className="truncate">{basename(value) || "~"}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0" align="start">
        {open && <CwdBrowser value={value} onChange={onChange} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
