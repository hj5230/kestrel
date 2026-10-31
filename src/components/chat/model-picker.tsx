// Choosing the model and its reasoning effort: the searchable model list, and the toolbar control that shows both.
import { useState } from "preact/hooks"
import { BrainIcon, CheckIcon, ChevronDownIcon, Settings2Icon } from "lucide-react"
import { PREFERRED_EFFORTS, resolveThinking } from "@shared/effort"
import type { ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatTokens } from "@/lib/format"
import { enabledModels, findModel, providers, route } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"
import { Panel, blurOnScroll } from "./pickers"

export function ModelList({
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

export const KNOWN_EFFORTS = new Set(["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"])

export function effortLabel(v: string) {
  return KNOWN_EFFORTS.has(v) ? t(`thinking.${v}` as MessageKey) : v
}

/** The model and its reasoning effort as one button. The choices are that model's own list. */
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
  const choices = current?.reasoning && current.efforts?.length ? current.efforts : null
  const selected = choices && thinking ? resolveThinking(thinking, choices, current?.effortDefault) : null
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button variant="ghost" size="sm" className="max-w-[42vw] gap-1 px-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10 sm:max-w-56">
          <span className="truncate">{current?.name ?? (modelId || t("picker.selectModel"))}</span>
          {/* The effort stays whole on narrow screens; the model name gives up its width first. */}
          {choices && <span className="shrink-0">· {selected ? effortLabel(selected) : t("picker.effortDefault")}</span>}
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
      {choices && (
        <div className="border-t p-2.5">
          <div className="mb-1.5 text-xs text-muted-foreground">{t("picker.thinking")}</div>
          <div className="flex flex-wrap gap-1">
            {choices.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  onThinking(v)
                  setOpen(false)
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-xs pointer-coarse:min-h-10",
                  v === selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {effortLabel(v)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

export function ThinkingPicker({ value, choices = PREFERRED_EFFORTS, onChange }: { value: ThinkingLevel; choices?: string[]; onChange: (v: ThinkingLevel) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground hover:text-foreground" title={t("picker.thinking")}>
          <BrainIcon />
          <span>{choices.includes(value) ? effortLabel(value) : t("picker.effortDefault")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>{t("picker.thinking")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v === "__default" ? "" : v)}>
          {["", ...choices].map((v) => (
            <DropdownMenuRadioItem key={v} value={v || "__default"}>
              {v ? effortLabel(v) : t("picker.effortDefault")}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
