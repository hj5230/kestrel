import { useState } from "preact/hooks"
import type { ComponentType } from "preact"
import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FilePenLineIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  GlobeIcon,
  HistoryIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  BanIcon,
} from "lucide-react"
import type { BashDetails, EditDetails, SubagentDetails, Todo, ToolCallBlock, ToolResultMsg } from "@shared/protocol"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DiffView, simpleDiff } from "./diff-view"
import { formatDuration, shortPath } from "@/lib/format"
import { highlight, languageFromPath } from "@/lib/markdown"
import { appInfo } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

export type ToolState = "running" | "pending" | "done" | "error" | "denied" | "interrupted"

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
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
  search_sessions: HistoryIcon,
  read_session: MessagesSquareIcon,
  skill: SparklesIcon,
}


const p = (v: unknown) => shortPath(String(v ?? ""), appInfo.value?.home)

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
    case "skill":
      return a.name ?? ""
    case "todo_write":
      return `${(a.todos ?? []).filter((t: Todo) => t.status === "completed").length}/${(a.todos ?? []).length}`
    default:
      return JSON.stringify(a).slice(0, 160)
  }
}

function resultText(r?: ToolResultMsg): string {
  return r?.content.map((c) => (c.type === "text" ? c.text : t("tool.imagePlaceholder"))).join("\n") ?? ""
}

function mcpLabel(name: string) {
  const [, server, tool] = name.split("__")
  return { server, tool }
}

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul className="grid gap-1 py-1">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          {t.status === "completed" ? (
            <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : t.status === "in_progress" ? (
            <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary [animation-duration:3s]" />
          ) : (
            <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
          )}
          <span className={cn(t.status === "completed" && "text-muted-foreground line-through decoration-muted-foreground/40", t.status === "in_progress" && "font-medium")}>
            {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
          </span>
        </li>
      ))}
    </ul>
  )
}

function OutputBlock({ text, className, language }: { text: string; className?: string; language?: string }) {
  if (!text) return <div className="px-3 py-2 text-xs text-muted-foreground">{t("tool.noOutput")}</div>
  return (
    <pre className={cn("max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55] whitespace-pre-wrap break-all", className)}>
      {language ? <code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(text, language) }} /> : text}
    </pre>
  )
}

function stripLineNumbers(t: string) {
  return t
    .split("\n")
    .map((l) => l.replace(/^\s*\d+\t/, ""))
    .join("\n")
}

function Body({ call, result, partial, state }: { call: ToolCallBlock; result?: ToolResultMsg; partial?: any; state: ToolState }) {
  const a = call.arguments ?? {}
  const details = (result?.details ?? partial) as any
  const text = resultText(result)

  if (call.name === "bash" || call.name === "bash_output") {
    const d = details as BashDetails | undefined
    const out = d?.output ?? (result ? text : "")
    return (
      <div className="bg-code">
        {call.name === "bash" && (
          <div className="border-b border-border/60 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-all select-text">
            <span className="select-none text-muted-foreground">$ </span>
            {a.command}
          </div>
        )}
        <OutputBlock text={state === "running" ? out : out || text} />
        {d && d.exitCode !== null && d.exitCode !== undefined && (
          <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
            <span className={cn(d.exitCode === 0 ? "text-success" : "text-destructive")}>exit {d.exitCode}</span>
            <span>{formatDuration(d.durationMs)}</span>
            {d.timedOut && <span className="text-destructive">{t("tool.timedOut")}</span>}
          </div>
        )}
      </div>
    )
  }
  if (call.name === "edit" || call.name === "write") {
    const d = details as EditDetails | undefined
    const diff = d?.diff ?? (call.name === "edit" ? simpleDiff(a.old_string ?? "", a.new_string ?? "") : simpleDiff("", a.content ?? ""))
    return (
      <>
        <DiffView diff={diff} />
        {state === "error" && <OutputBlock text={text} className="border-t text-destructive" />}
      </>
    )
  }
  if (call.name === "read" && !result?.isError) {
    const img = result?.content.find((c) => c.type === "image") as any
    if (img) return <img src={`data:${img.mimeType};base64,${img.data}`} className="max-h-80 p-2" />
    return <OutputBlock text={stripLineNumbers(text)} language={languageFromPath(String(a.path ?? ""))} />
  }
  if (call.name === "web_search" && details?.results) {
    return (
      <ul className="grid gap-2 px-3 py-2 select-text">
        {details.results.map((r: any, i: number) => (
          <li key={i} className="text-[13px]">
            <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              {r.title}
            </a>
            <div className="truncate text-xs text-muted-foreground">{r.url}</div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</div>
          </li>
        ))}
      </ul>
    )
  }
  const showArgs = call.name.startsWith("mcp__") || !ICONS[call.name]
  return (
    <>
      {showArgs && <OutputBlock text={JSON.stringify(a, null, 2)} language="json" className="border-b border-border/60" />}
      {(result || state !== "running") && <OutputBlock text={text} className={cn(result?.isError && "text-destructive")} />}
    </>
  )
}

function SubagentCard({
  call,
  result,
  partial,
  state,
  onOpen,
  expand,
}: {
  call: ToolCallBlock
  result?: ToolResultMsg
  partial?: any
  state: ToolState
  onOpen?: (id: string) => void
  expand?: boolean
}) {
  const d = (partial ?? result?.details) as SubagentDetails | undefined
  const [open, setOpen] = useState(!!expand)
  const text = resultText(result)
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {state === "running" ? <Spinner className="size-3.5" /> : <BotIcon className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{call.arguments?.description ?? t("tool.task")}</div>
          <div className={cn("truncate text-xs text-muted-foreground", state === "running" && "text-shimmer")}>
            {state === "running" ? d?.lastActivity || t("tool.starting") : state === "error" ? t("tool.failed") : state === "done" ? t("tool.done") : t("tool.interrupted")}
            {d?.toolCalls ? t("tool.calls", { n: d.toolCalls }) : ""}
          </div>
        </div>
        {d?.sessionId && onOpen && (
          <Button variant="ghost" size="xs" onClick={() => onOpen(d.sessionId)}>
            <ExternalLinkIcon />
            {t("tool.viewRun")}
          </Button>
        )}
        {result && (
          <Button variant="ghost" size="icon-xs" onClick={() => setOpen(!open)}>
            <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
          </Button>
        )}
      </div>
      {open && result && <OutputBlock text={text} className={cn("border-t bg-muted/30", result.isError && "text-destructive")} />}
    </div>
  )
}

export function ToolCallView({
  call,
  result,
  partial,
  state,
  onOpenSubagent,
  expand,
}: {
  call: ToolCallBlock
  result?: ToolResultMsg
  partial?: any
  state: ToolState
  onOpenSubagent?: (id: string) => void
  expand?: boolean
}) {
  const isEdit = call.name === "edit" || call.name === "write"
  const editLines = isEdit ? ((result?.details as EditDetails | undefined)?.added ?? 0) + ((result?.details as EditDetails | undefined)?.removed ?? 0) : 0
  const [open, setOpen] = useState(
    expand || (state === "running" && call.name === "bash") || (isEdit && state === "done" && editLines > 0 && editLines <= 30),
  )

  if (call.name === "task") return <SubagentCard call={call} result={result} partial={partial} state={state} onOpen={onOpenSubagent} expand={expand} />
  if (call.name === "todo_write") {
    return (
      <div className="rounded-xl border bg-card px-3 py-2">
        <div className="mb-0.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListChecksIcon className="size-3.5" />
          {t("chat.plan")}
        </div>
        <TodoList todos={call.arguments?.todos ?? []} />
      </div>
    )
  }

  const Icon = toolIcon(call.name)
  const label = toolLabel(call.name)
  const d = result?.details as any
  const isEditDetails = isEdit && d && typeof d.added === "number"

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/tool">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition-colors hover:bg-muted/70",
            open && "bg-muted/50",
          )}
        >
          <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", state === "error" && "text-destructive")} />
          <span className={cn("shrink-0 font-medium", state === "running" && "text-shimmer")}>{label}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">{summary(call)}</span>
          {isEditDetails && (
            <span className="shrink-0 font-mono text-[11px]">
              <span className="text-success">+{d.added}</span> <span className="text-destructive">-{d.removed}</span>
            </span>
          )}
          {call.name === "bash" && d?.exitCode !== undefined && d?.exitCode !== null && d.exitCode !== 0 && (
            <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
              exit {d.exitCode}
            </Badge>
          )}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {state === "running" ? (
              <Spinner className="size-3.5 text-muted-foreground" />
            ) : state === "pending" ? (
              <CircleDashedIcon className="size-3.5 text-warning" />
            ) : state === "error" ? (
              <XIcon className="size-3.5 text-destructive" />
            ) : state === "denied" || state === "interrupted" ? (
              <BanIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <CheckIcon className="size-3.5 text-muted-foreground/60 opacity-0 transition-opacity group-hover/tool:opacity-100" />
            )}
          </span>
          <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 mb-1.5 ml-6 overflow-hidden rounded-lg border bg-card">
          <Body call={call} result={result} partial={partial} state={state} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { TodoList }
