// The agent's process between replies: one step, or a folded group of steps with what is running now.
import { useState } from "preact/hooks"
import { ChevronRightIcon, CircleDashedIcon, ListTreeIcon } from "lucide-react"
import { KestrelMark } from "@/components/kestrel-mark"
import { Thinking } from "./messages"
import { summary, toolLabel, ToolCallView } from "./tool-call"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { toolState, describeGroup, type Runtime, type Step } from "./transcript-rows"

export function StepView({ step, rt, expand, onOpenSubagent }: { step: Step; rt: Runtime; expand: boolean; onOpenSubagent?: (id: string) => void }) {
  if (step.k === "thinking") return <Thinking text={step.block.thinking} streaming={step.streaming} defaultOpen={expand} />
  const running = rt.running[step.block.id]
  return (
    <ToolCallView
      call={step.block}
      result={rt.results.get(step.block.id)}
      partial={running?.partial}
      state={toolState(step, rt)}
      onOpenSubagent={onOpenSubagent}
      expand={expand}
    />
  )
}

export function ProcessGroup({
  steps,
  rt,
  waiting,
  expandable,
  phase,
  onOpenSubagent,
}: {
  steps: Step[]
  rt: Runtime
  waiting: boolean
  expandable: boolean
  /** Reuse the process row during gaps between model/tool steps instead of adding a status row. */
  phase?: string
  onOpenSubagent?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const states = steps.map((s) => (s.k === "tool" ? toolState(s, rt) : s.streaming ? "running" : "done"))
  const active = states.some((s) => s === "running" || s === "pending")
  const failed = states.filter((s) => s === "error").length
  let activity = ""
  if (active) {
    let idx = states.length - 1
    while (idx > 0 && states[idx] !== "running" && states[idx] !== "pending") idx--
    const step = steps[idx]
    activity = step.k === "thinking" ? t("group.thinking") : `${toolLabel(step.block.name)} ${summary(step.block)}`.trim()
  }
  const label = waiting ? t("group.waiting") : active ? activity || t("group.working") : phase || describeGroup(steps)
  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-muted-foreground transition-colors pointer-coarse:min-h-10",
          expandable && "hover:bg-muted/70 hover:text-foreground",
          open && "bg-muted/50 text-foreground",
        )}
      >
        {waiting ? (
          <CircleDashedIcon className="size-3.5 shrink-0 text-warning" />
        ) : active || phase ? (
          <KestrelMark />
        ) : (
          <ListTreeIcon className="size-3.5 shrink-0" />
        )}
        <span className={cn("min-w-0 truncate", (active || phase) && !waiting && "text-shimmer")}>{label}</span>
        {failed > 0 && <span className="shrink-0 text-xs text-destructive">· {t("group.failed", { n: failed })}</span>}
        {expandable && <ChevronRightIcon className={cn("ml-auto size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="mt-1 ml-3.5 flex flex-col gap-1.5 border-l pl-3">
          {steps.map((s) => (
            <StepView key={s.key} step={s} rt={rt} expand={false} onOpenSubagent={onOpenSubagent} />
          ))}
        </div>
      )}
    </div>
  )
}
