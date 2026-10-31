// The menu that opens while typing: slash commands after a leading "/", project files after "@".
import { useEffect, useMemo, useState } from "preact/hooks"
import { FileIcon, SparklesIcon, TerminalSquareIcon, ZapIcon } from "lucide-react"
import type { SlashCommandInfo } from "@shared/protocol"
import { rpc } from "@/lib/api"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

export interface MenuItem {
  key: string
  label: string
  detail?: string
  kind: "builtin" | "prompt" | "skill" | "file"
  insert: string
}

const KIND_ICON = { builtin: TerminalSquareIcon, prompt: ZapIcon, skill: SparklesIcon, file: FileIcon }

/** What the text before the caret asks for, and the menu for it. `apply` returns the new text and caret. */
export function useCompletions(cwd: string, text: string, caret: number) {
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    rpc<SlashCommandInfo[]>("commands.list", { cwd }).then(setCommands).catch(() => {})
  }, [cwd])

  const before = text.slice(0, caret)
  const slash = /^\/(\S*)$/.exec(before)
  const mention = !slash ? /(^|\s)@([^\s@]*)$/.exec(before) : null
  const mentionQuery = mention?.[2] ?? null

  useEffect(() => {
    if (mentionQuery === null) return
    const timer = setTimeout(() => {
      rpc<string[]>("fs.complete", { cwd, query: mentionQuery, limit: 12 }).then(setFiles).catch(() => setFiles([]))
    }, 80)
    return () => clearTimeout(timer)
  }, [mentionQuery, cwd])

  const items: MenuItem[] = useMemo(() => {
    if (slash) {
      const q = slash[1].toLowerCase()
      return commands
        .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
        .slice(0, 50)
        .map((c) => ({ key: `${c.kind}:${c.name}`, label: `/${c.name}`, detail: c.description, kind: c.kind, insert: `/${c.name} ` }))
    }
    if (mention) return files.map((f) => ({ key: f, label: f, kind: "file" as const, insert: `@${f} ` }))
    return []
  }, [slash?.[1], mention?.[2], commands, files])

  const key = slash ? `/${slash[1]}` : mention ? `@${mention[2]}` : null
  const open = items.length > 0 && key !== null && dismissed !== key
  useEffect(() => setIndex(0), [key])

  const apply = (item: MenuItem): { text: string; caret: number } => {
    if (item.kind === "file" && mention) {
      const start = caret - mention[2].length - 1
      return { text: text.slice(0, start) + item.insert + text.slice(caret), caret: start + item.insert.length }
    }
    return { text: item.insert + text.slice(caret), caret: item.insert.length }
  }

  return {
    open,
    items,
    index,
    setIndex,
    apply,
    dismiss: () => setDismissed(key),
    /** Typing again brings a dismissed menu back. */
    reset: () => setDismissed(null),
  }
}

export function CompletionMenu({
  items,
  index,
  below,
  onHover,
  onPick,
}: {
  items: MenuItem[]
  index: number
  below?: boolean
  onHover: (i: number) => void
  onPick: (item: MenuItem) => void
}) {
  return (
    <div className={cn("absolute inset-x-0 z-30 max-h-72", below ? "top-full mt-2" : "bottom-full mb-2", "overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg")}>
      {items.map((item, i) => {
        const Icon = KIND_ICON[item.kind]
        return (
          <button
            key={item.key}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(item)
            }}
            onMouseEnter={() => onHover(i)}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm pointer-coarse:min-h-11", i === index && "bg-accent text-accent-foreground")}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn("shrink-0", item.kind === "file" ? "truncate font-mono text-xs" : "font-medium")}>{item.label}</span>
            {item.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.detail}</span>}
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{t(`composer.kind.${item.kind}` as MessageKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
