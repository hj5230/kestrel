// How a tool call is named and summarized in one line: its icon, label and the argument worth showing.
import type { ComponentType } from "preact"
import { BotIcon, BrainIcon, CircleHelpIcon, FileTextIcon, FilePenLineIcon, FilePlusIcon, FolderOpenIcon, FolderSearchIcon, GlobeIcon, HistoryIcon, ListChecksIcon, MessagesSquareIcon, PlugIcon, ScrollTextIcon, SearchIcon, SparklesIcon, SquareIcon, TerminalIcon, WrenchIcon } from "lucide-react"
import type { Todo, ToolCallBlock, ToolResultMsg } from "@shared/protocol"
import { shortPath } from "@/lib/format"
import { appInfo } from "@/lib/store"
import { t, type MessageKey } from "@/lib/i18n"

export type ToolState = "running" | "pending" | "done" | "error" | "denied" | "interrupted"

export const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  read: FileTextIcon,
  write: FilePlusIcon,
  edit: FilePenLineIcon,
  ls: FolderOpenIcon,
  glob: FolderSearchIcon,
  grep: SearchIcon,
  bash: TerminalIcon,
  bash_output: ScrollTextIcon,
  kill_shell: SquareIcon,
  web_fetch: GlobeIcon,
  web_search: GlobeIcon,
  todo_write: ListChecksIcon,
  task: BotIcon,
  ask_user: CircleHelpIcon,
  search_sessions: HistoryIcon,
  read_session: MessagesSquareIcon,
  skill: SparklesIcon,
  memory_search: BrainIcon,
  memory_read: BrainIcon,
  memory_write: BrainIcon,
  memory_delete: BrainIcon,
}

export const p = (v: unknown) => shortPath(String(v ?? ""), appInfo.value?.home)

export function toolIcon(name: string): ComponentType<{ className?: string }> {
  if (name.startsWith("mcp__")) return PlugIcon
  return ICONS[name] ?? WrenchIcon
}

export function toolLabel(name: string): string {
  if (name.startsWith("mcp__")) {
    const { server, tool } = mcpLabel(name)
    return `${server} · ${tool}`
  }
  return ICONS[name] ? t(`tool.${name}` as MessageKey) : name
}

export function summary(call: ToolCallBlock): string {
  const a = call.arguments ?? {}
  switch (call.name) {
    case "read":
      return p(a.path) + (a.offset ? `:${a.offset}${a.limit ? `-${a.offset + a.limit - 1}` : ""}` : "")
    case "write":
    case "edit":
      return p(a.path)
    case "ls":
      return p(a.path ?? ".")
    case "glob":
      return `${a.pattern ?? ""}${a.path ? `  in ${p(a.path)}` : ""}`
    case "grep":
      return `${a.pattern ?? ""}${a.glob ? `  (${a.glob})` : ""}${a.path ? `  in ${p(a.path)}` : ""}`
    case "bash":
      return a.command ?? ""
    case "bash_output":
    case "kill_shell":
      return a.shell_id ?? ""
    case "web_fetch":
      return a.url ?? ""
    case "web_search":
    case "search_sessions":
      return a.query ?? ""
    case "read_session":
      return a.session_id ?? ""
    case "task":
      return a.description ?? ""
    case "ask_user":
      return a.questions?.[0]?.question ?? a.title ?? ""
    case "skill":
      return a.name ?? ""
    case "memory_write":
      return `${a.topic ?? ""}/${a.name ?? ""}`
    case "memory_read":
    case "memory_delete":
      return a.id ?? ""
    case "memory_search":
      return [a.query, a.topic && `in ${a.topic}`].filter(Boolean).join("  ")
    case "todo_write":
      return `${(a.todos ?? []).filter((t: Todo) => t.status === "completed").length}/${(a.todos ?? []).length}`
    default:
      return JSON.stringify(a).slice(0, 160)
  }
}

export function resultText(r?: ToolResultMsg): string {
  return r?.content.map((c) => (c.type === "text" ? c.text : t("tool.imagePlaceholder"))).join("\n") ?? ""
}

export function mcpLabel(name: string) {
  const [, server, tool] = name.split("__")
  return { server, tool }
}
