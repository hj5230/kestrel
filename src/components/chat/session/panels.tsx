// What opens beside a conversation: the plan (docked on wide windows, a drawer on narrow ones, a bottom sheet on
// touch screens like every other menu there) and a subagent's transcript.
import { useEffect } from "preact/hooks"
import { ListChecksIcon, XIcon } from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { isTouch } from "@/lib/platform"
import { detailSignal, loadDetail, settings } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { TodoList } from "../tool-call"
import { Transcript } from "../transcript"

/** On a phone the panel is a sheet: its close button sits in the header row, after the count, instead of on top of it. */
export function PlanPanel({ todos, onClose }: { todos: SessionInfo["todos"]; onClose?: () => void }) {
  const open = todos.some((t) => t.status !== "completed")
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <ListChecksIcon className="size-4 text-muted-foreground" />
        {t("chat.plan")}
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
          {todos.filter((t) => t.status === "completed").length}/{todos.length}
        </span>
        {onClose && (
          <Button variant="ghost" size="icon-sm" className="-my-1 -mr-2" aria-label={t("common.close")} onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      <div className={cn("px-4 py-3", !open && "opacity-70")}>
        <TodoList todos={todos} />
      </div>
    </>
  )
}

export function PlanSheet({ open, onOpenChange, todos }: { open: boolean; onOpenChange: (o: boolean) => void; todos: SessionInfo["todos"] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isTouch ? "bottom" : "right"}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={isTouch ? { bottom: "var(--kb, 0px)", maxHeight: "min(80vh, calc(var(--app-height, 100vh) - 24px))" } : undefined}
        className={cn("gap-0 p-0", isTouch ? "overflow-y-auto overscroll-contain rounded-t-2xl pb-[var(--inset-bottom)]" : "w-[min(22rem,88vw)]")}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t("chat.plan")}</SheetTitle>
          <SheetDescription>{t("chat.plan")}</SheetDescription>
        </SheetHeader>
        <PlanPanel todos={todos} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

export function SubagentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const sig = id ? detailSignal(id) : null
  useEffect(() => {
    if (id) loadDetail(id).catch(() => {})
  }, [id])
  const d = sig?.value
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(720px,92vw)] gap-0 sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>{d?.session.title ?? t("chat.subagent")}</SheetTitle>
          <SheetDescription>{t("chat.subagentDesc")}</SheetDescription>
        </SheetHeader>
        <div data-transcript-scroll className="flex-1 overflow-y-auto px-6 py-5">{d ? <Transcript d={d} view={settings.value?.transcriptView ?? "compact"} readOnly /> : <Spinner />}</div>
      </SheetContent>
    </Sheet>
  )
}
