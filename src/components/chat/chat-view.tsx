import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  ArrowDownIcon,
  DownloadIcon,
  FolderIcon,
  GitBranchIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ShrinkIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { AssistantMsg, SessionInfo, ThinkingLevel, PermissionMode } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ConfirmDeleteDialog, RenameDialog } from "@/components/session-dialogs"
import { Composer, type Attachment } from "./composer"
import { ApprovalCard } from "./approval-card"
import { AssistantMessage, CompactionDivider, ErrorCard, UserMessage, userText, useToolResults, type ToolRuntime } from "./messages"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker } from "./pickers"
import { ContextMeter } from "./context-meter"
import { TodoList } from "./tool-call"
import { rpc } from "@/lib/api"
import { downloadText } from "@/lib/download"
import { shortPath } from "@/lib/format"
import { appInfo, createSession, detailSignal, enabledModels, findModel, loadDetail, openSession, type DetailState } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      atBottom.current = near
      setShowJump(!near)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, deps)
  const jump = () => {
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }
  return { ref, showJump, jump }
}

function Transcript({ d, readOnly, onOpenSubagent, onEdit, onFork, onRetry }: {
  d: DetailState
  readOnly?: boolean
  onOpenSubagent?: (id: string) => void
  onEdit?: (seq: number, text: string) => void
  onFork?: (seq: number) => void
  onRetry?: () => void
}) {
  const results = useToolResults(d.messages)
  const running = d.session.status === "running" || d.session.status === "waiting"
  const rt: ToolRuntime = { results, running: d.runningTools, runActive: running }
  const compactionsAt = useMemo(() => {
    const m = new Map<number, typeof d.compactions>()
    for (const c of d.compactions) m.set(c.cutSeq, [...(m.get(c.cutSeq) ?? []), c])
    return m
  }, [d.compactions])
  const last = d.messages[d.messages.length - 1]
  const lastAssistantError = !running && last?.message.role === "assistant" && last.message.stopReason === "error" ? (last.message as AssistantMsg) : null
  const configError = !running && d.session.status === "error" && !lastAssistantError && d.session.lastError
  const streamingVisible = !!d.streaming?.content.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()) || c.type === "toolCall")
  const busyIdle = running && !streamingVisible && Object.keys(d.runningTools).length === 0 && d.approvals.length === 0
  const maxSeq = last?.seq ?? -1

  return (
    <div className="flex flex-col gap-6">
      {d.messages.map((s) => {
        const divs = compactionsAt.get(s.seq)?.map((c) => <CompactionDivider key={`c${c.id}`} c={c} />) ?? null
        const m = s.message
        let body = null
        if (m.role === "user") {
          body = (
            <UserMessage
              stored={s}
              canEdit={!readOnly && !running}
              onEdit={(seq, text) => onEdit?.(seq, text)}
              onFork={(seq) => onFork?.(seq)}
            />
          )
        } else if (m.role === "assistant") {
          const hasContent = m.content.some((c) => (c.type === "text" && c.text.trim()) || c.type === "toolCall" || (c.type === "thinking" && c.thinking.trim()))
          if (hasContent) body = <AssistantMessage msg={m} rt={rt} onOpenSubagent={onOpenSubagent} showMeta={m.stopReason !== "toolUse"} />
        }
        if (!divs && !body) return null
        return (
          <div key={s.seq} className="flex flex-col gap-6">
            {divs}
            {body}
          </div>
        )
      })}
      {d.compactions.filter((c) => c.cutSeq > maxSeq).map((c) => (
        <CompactionDivider key={`c${c.id}`} c={c} />
      ))}
      {d.streaming && streamingVisible && <AssistantMessage msg={d.streaming} rt={rt} streaming onOpenSubagent={onOpenSubagent} />}
      {(busyIdle || d.compacting) && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" />
          <span className="text-shimmer">{d.compacting ? t("chat.compacting") : t("chat.thinking")}</span>
        </div>
      )}
      {lastAssistantError && <ErrorCard message={lastAssistantError.errorMessage ?? t("common.unknownError")} onRetry={readOnly ? undefined : onRetry} />}
      {configError && <ErrorCard message={d.session.lastError!} onRetry={readOnly || last?.message.role !== "user" ? undefined : onRetry} />}
    </div>
  )
}

function SubagentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
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
        <div className="flex-1 overflow-y-auto px-6 py-5">{d ? <Transcript d={d} readOnly /> : <Spinner />}</div>
      </SheetContent>
    </Sheet>
  )
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const sig = detailSignal(sessionId)
  const d = sig.value
  const [subagent, setSubagent] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ seq: number; text: string; nonce: number } | null>(null)
  const [renaming, setRenaming] = useState<SessionInfo | null>(null)
  const [deleting, setDeleting] = useState<SessionInfo | null>(null)
  const [showPlan, setShowPlan] = useState(true)
  const { state: sidebarState } = useSidebar()

  useEffect(() => {
    loadDetail(sessionId).catch((e) => toast.error(e.message))
  }, [sessionId])

  const { ref, showJump, jump } = useStickToBottom([d?.messages.length, d?.streaming, d?.runningTools, d?.approvals.length, d?.compacting])

  const history = useMemo(
    () => (d?.messages ?? []).filter((m) => m.message.role === "user").map((m) => userText(m.message as any)).filter(Boolean),
    [d?.messages],
  )

  if (!d) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const s = d.session
  const running = s.status === "running" || s.status === "waiting"
  const model = findModel(s.providerId, s.modelId)
  const update = (patch: Partial<SessionInfo>) => rpc("sessions.update", { id: s.id, patch }).catch((e) => toast.error(e.message))
  const hasTodos = s.todos.length > 0 && s.todos.some((t) => t.status !== "completed")

  const send = async (text: string, images: Attachment[]) => {
    const imgs = images.map(({ data, mimeType }) => ({ type: "image", data, mimeType }))
    if (editing) {
      await rpc("chat.edit", { sessionId: s.id, seq: editing.seq, text, images: imgs })
      setEditing(null)
      return
    }
    if (!enabledModels.value.length) {
      toast.error(t("chat.addProviderFirst"))
      return false
    }
    await rpc("chat.send", { sessionId: s.id, text, images: imgs })
  }

  const fork = async (seq: number) => {
    const n = await rpc<SessionInfo>("sessions.fork", { id: s.id, seq })
    openSession(n.id)
    toast.success(t("chat.forked"))
  }

  const exportMd = async () => downloadText(`${s.title || "session"}.md`, await rpc<string>("sessions.export", { id: s.id }))

  const compact = (instructions?: string) =>
    rpc("chat.compact", { sessionId: s.id, instructions }).then(
      () => toast.success(t("chat.compacted")),
      (e) => toast.error(e.message),
    )

  const onBuiltin = (name: string, args: string) => {
    switch (name) {
      case "compact":
        compact(args || undefined)
        return true
      case "clear":
        createSession({ cwd: s.cwd, providerId: s.providerId, modelId: s.modelId, thinking: s.thinking, permissionMode: s.permissionMode })
        return true
      case "export":
        exportMd()
        return true
      case "fork":
        fork(d.messages[d.messages.length - 1]?.seq ?? -1)
        return true
      case "model": {
        const q = args.trim().toLowerCase()
        const m = q ? enabledModels.value.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase().includes(q)) : null
        if (m) {
          update({ providerId: m.providerId, modelId: m.id })
          toast.success(t("chat.switchedModel", { name: m.name }))
        } else toast.info(q ? t("chat.modelNotFound", { q: args }) : t("chat.modelUsage"))
        return true
      }
    }
    return false
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        data-tauri-drag-region
        className={cn("drag-region flex h-12 shrink-0 items-center gap-2 border-b px-3", sidebarState === "collapsed" && "pl-20")}
      >
        <SidebarTrigger className="text-muted-foreground" />
        <button type="button" onClick={() => setRenaming(s)} className="group/title flex min-w-0 max-w-[55%] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted">
          <span className={cn("truncate text-sm font-medium", !s.title && "text-muted-foreground")}>{s.title || t("common.untitled")}</span>
          <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100" />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => rpc("app.open", { path: s.cwd })}
              className="flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate font-mono">{shortPath(s.cwd, appInfo.value?.home)}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.openInFinder")}</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          <ContextMeter session={s} model={model} onCompact={() => compact()} compacting={d.compacting} />
          {s.todos.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={showPlan ? "secondary" : "ghost"} size="icon-sm" onClick={() => setShowPlan(!showPlan)}>
                  <ListChecksIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("chat.plan")}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setRenaming(s)}>
                <PencilIcon />
                {t("common.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => compact()} disabled={running}>
                <ShrinkIcon />
                {t("chat.compact")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fork(d.messages[d.messages.length - 1]?.seq ?? -1)}>
                <GitBranchIcon />
                {t("chat.fork")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportMd}>
                <DownloadIcon />
                {t("sidebar.exportMd")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(s)}>
                <Trash2Icon />
                {t("chat.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-10">
              {d.messages.length === 0 && !d.streaming ? (
                <div className="py-16 text-center text-sm text-muted-foreground">{t("chat.empty")}</div>
              ) : (
                <Transcript
                  d={d}
                  onOpenSubagent={setSubagent}
                  onEdit={(seq, text) => setEditing({ seq, text, nonce: Date.now() })}
                  onFork={fork}
                  onRetry={() => rpc("chat.retry", { sessionId: s.id }).catch((e) => toast.error(e.message))}
                />
              )}
            </div>
          </div>
          {showJump && (
            <Button variant="outline" size="icon-sm" onClick={jump} className="absolute bottom-40 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md">
              <ArrowDownIcon />
            </Button>
          )}
          <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-5">
            <div className="flex flex-col gap-2">
              {d.approvals.map((a) => (
                <ApprovalCard key={a.id} req={a} />
              ))}
              {d.queued.length > 0 && (
                <div className="flex flex-col gap-1">
                  {d.queued.map((q) => (
                    <div key={q.id} className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-1.5 text-xs">
                      <span className="shrink-0 text-muted-foreground">{q.mode === "steer" ? t("chat.queuedSteer") : t("chat.queuedFollow")}</span>
                      <span className="min-w-0 flex-1 truncate">{q.text}</span>
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => rpc("chat.cancelQueued", { sessionId: s.id, id: q.id })}>
                        <XIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {editing && (
                <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary">
                  <PencilIcon className="size-3.5" />
                  {t("chat.editing")}
                  <button type="button" className="ml-auto hover:underline" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              )}
              <Composer
                cwd={s.cwd}
                running={running}
                draftKey={s.id}
                history={history}
                autoFocus
                initial={editing ? { text: editing.text, nonce: editing.nonce } : null}
                onSubmit={send}
                onAbort={() => rpc("chat.abort", { sessionId: s.id })}
                onBuiltin={onBuiltin}
                toolbar={
                  <>
                    <PermissionPicker value={s.permissionMode} onChange={(v: PermissionMode) => update({ permissionMode: v })} />
                    <ModelPicker providerId={s.providerId} modelId={s.modelId} onChange={(providerId, modelId) => update({ providerId, modelId })} />
                    {model?.reasoning && <ThinkingPicker value={s.thinking} onChange={(v: ThinkingLevel) => update({ thinking: v })} />}
                    {s.messageCount === 0 && <CwdPicker value={shortPath(s.cwd, appInfo.value?.home)} onChange={(cwd) => update({ cwd })} />}
                  </>
                }
              />
            </div>
          </div>
        </div>
        {showPlan && s.todos.length > 0 && (
          <aside className="hidden w-72 shrink-0 border-l bg-sidebar/40 lg:block">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <ListChecksIcon className="size-4 text-muted-foreground" />
              {t("chat.plan")}
              <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
                {s.todos.filter((t) => t.status === "completed").length}/{s.todos.length}
              </span>
            </div>
            <div className={cn("px-4 py-3", !hasTodos && "opacity-70")}>
              <TodoList todos={s.todos} />
            </div>
          </aside>
        )}
      </div>
      <SubagentSheet id={subagent} onClose={() => setSubagent(null)} />
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
