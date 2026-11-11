// The plan's latest state, once, at the end of the conversation. Open while the agent works or items remain.
import { useEffect, useState } from "preact/hooks"
import { ChevronRightIcon, ListChecksIcon } from "lucide-react"
import type { Todo } from "@shared/protocol"
import { TodoList } from "./tool-body"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function InlinePlan({ todos, latest }: { todos: unknown; latest: boolean }) {
  const list = Array.isArray(todos) ? todos.filter((x): x is Todo => !!x && typeof x.content === "string" && ["pending", "in_progress", "completed"].includes(x.status)) : []
  const wanted = latest || list.some((x) => x.status !== "completed")
  const [open, setOpen] = useState(wanted)
  useEffect(() => setOpen(wanted), [wanted])
  if (!list.length) return null
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground pointer-coarse:min-h-10">
        <ListChecksIcon className="size-3.5" />
        {t("chat.plan")}
        <span className="ml-auto tabular-nums">{list.filter((x) => x.status === "completed").length}/{list.length}</span>
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {open && <TodoList todos={list} />}
    </div>
  )
}
