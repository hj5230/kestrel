// The plan, shown once per turn in its latest state. A plan belongs to the turn that last wrote it:
// - while that turn runs it sits at the end of the transcript, open, with the current item spinning;
// - when the turn ends it folds to one line saying whether it finished, stopped (the user interrupted)
//   or was left unfinished, and stays at the end until the user sends the next message;
// - after that it is history: folded, in place where the turn last updated it, and no longer at the end.
import { useEffect, useState } from "preact/hooks"
import { ChevronRightIcon, ListChecksIcon } from "lucide-react"
import type { Todo } from "@shared/protocol"
import { TodoList } from "./tool-body"
import type { Row } from "./transcript-rows"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface PlanPlacement {
  /** The plan rows that are the last update of a finished turn, with whether that turn was stopped. */
  history: Map<string, { stopped: boolean }>
  /** The current turn's plan, shown at the end. */
  current: { row: Extract<Row, { k: "plan" }>; stopped: boolean } | null
}

export function placePlans(rows: Row[]): PlanPlacement {
  const history = new Map<string, { stopped: boolean }>()
  let plan: Extract<Row, { k: "plan" }> | null = null
  let stopped = false
  for (const row of rows) {
    // A merge note joins the current turn; any other user message starts a new one.
    if (row.k === "user" && !(row.stored.message.role === "user" && row.stored.message.merge)) {
      if (plan) history.set(plan.key, { stopped })
      plan = null
      stopped = false
    } else if (row.k === "plan") {
      plan = row
      stopped = false
    } else if (row.k === "aborted" && plan) stopped = true
  }
  return { history, current: plan && { row: plan, stopped } }
}

const todosOf = (todos: unknown): Todo[] =>
  Array.isArray(todos) ? todos.filter((x): x is Todo => !!x && typeof x.content === "string" && ["pending", "in_progress", "completed"].includes(x.status)) : []

export function InlinePlan({ todos, live, stopped }: { todos: unknown; live: boolean; stopped: boolean }) {
  const list = todosOf(todos)
  const [open, setOpen] = useState(live)
  useEffect(() => setOpen(live), [live])
  if (!list.length) return null
  const done = list.filter((x) => x.status === "completed").length
  const outcome = live ? null : done === list.length ? "done" : stopped ? "stopped" : "unfinished"
  return (
    <div className={cn("rounded-xl border px-3 py-2", live ? "bg-card" : "bg-transparent")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground pointer-coarse:min-h-10">
        <ListChecksIcon className="size-3.5" />
        {t("chat.plan")}
        {outcome && <span className={cn("font-normal", outcome === "done" && "text-success")}>· {t(`chat.plan.${outcome}`)}</span>}
        <span className="ml-auto tabular-nums">{done}/{list.length}</span>
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && <TodoList todos={list} live={live} />}
    </div>
  )
}
