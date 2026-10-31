import { useState } from "preact/hooks"
import { CheckIcon, ChevronRightIcon, CircleDashedIcon, ListChecksIcon, XIcon, BanIcon } from "lucide-react"
import type { AskDetails, EditDetails, ToolCallBlock, ToolResultMsg } from "@shared/protocol"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { QuestionSummary } from "./question-card"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { TodoList, Body, SubagentCard } from "./tool-body"
import { toolIcon, toolLabel, summary, type ToolState } from "./tool-meta"
export { toolIcon, toolLabel, summary, type ToolState } from "./tool-meta"

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
  if (call.name === "ask_user" && (result?.details as AskDetails | undefined)?.questions) {
    return <QuestionSummary details={result!.details as AskDetails} />
  }
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
            "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition-colors hover:bg-muted/70 pointer-coarse:min-h-10",
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
