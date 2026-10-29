import { useEffect, useMemo, useState } from "preact/hooks"
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
import type { SessionInfo, ThinkingLevel, PermissionMode } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
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
import { QuestionCard } from "./question-card"
import { userText } from "./messages"
import { Transcript } from "./transcript"
import { ViewPicker } from "./view-picker"
import { ModelControl, PermissionPicker } from "./pickers"
import { ContextMeter } from "./context-meter"
import { TodoList } from "./tool-call"
import { rpc, stageAttachments, type StagedFile } from "@/lib/api"
import { isMobileApp } from "@/lib/platform"
import { downloadText } from "@/lib/download"
import { shortPath } from "@/lib/format"
import { appInfo, createSession, detailSignal, draftKeyForHost, enabledModels, findModel, loadDetail, openSession, settings } from "@/lib/store"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

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
        <div className="flex-1 overflow-y-auto px-6 py-5">{d ? <Transcript d={d} view={settings.value?.transcriptView ?? "compact"} readOnly /> : <Spinner />}</div>
      </SheetContent>
    </Sheet>
  )
}

function PlanPanel({ todos }: { todos: SessionInfo["todos"] }) {
  const open = todos.some((t) => t.status !== "completed")
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        <ListChecksIcon className="size-4 text-muted-foreground" />
        {t("chat.plan")}
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
          {todos.filter((t) => t.status === "completed").length}/{todos.length}
        </span>
      </div>
      <div className={cn("px-4 py-3", !open && "opacity-70")}>
        <TodoList todos={todos} />
      </div>
    </>
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
  // Wide windows dock the plan beside the transcript; narrower screens open it as a drawer on demand.
  const wide = useMediaQuery("(min-width: 1024px)")
  const [planSheet, setPlanSheet] = useState(false)

  useEffect(() => {
    loadDetail(sessionId).catch((e) => toast.error(e.message))
  }, [sessionId])

  const { ref, detached, jump, follow } = useStickToBottom([d?.messages.length, d?.streaming, d?.runningTools, d?.approvals.length, d?.questions.length, d?.compacting])

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

  const send = async (text: string, images: Attachment[], files: StagedFile[]) => {
    if (!editing && !enabledModels.value.length) {
      toast.error(t("chat.addProviderFirst"))
      return false
    }
    const imgs = images.map(({ data, mimeType }) => ({ type: "image", data, mimeType }))
    const uploaded = await stageAttachments(s.id, files)
    follow()
    if (editing) {
      await rpc("chat.edit", { sessionId: s.id, seq: editing.seq, text, images: imgs, files: uploaded })
      setEditing(null)
      return
    }
    await rpc("chat.send", { sessionId: s.id, text, images: imgs, files: uploaded })
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
      <PageHeader>
        <button type="button" onClick={() => setRenaming(s)} className="group/title flex min-w-0 max-w-[55%] shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted pointer-coarse:min-h-10">
          <span className={cn("truncate text-sm font-medium", !s.title && "text-muted-foreground")}>{s.title || t("common.untitled")}</span>
          <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100" />
        </button>
        {isMobileApp ? (
          // The folder lives on the Mac; there is no Finder to open it in from here.
          <span className="hidden min-w-0 shrink items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground sm:flex">
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{shortPath(s.cwd, appInfo.value?.home)}</span>
          </span>
        ) : (
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
        )}
        <div className="ml-auto flex items-center gap-1">
          <ViewPicker />
          <ContextMeter session={s} model={model} onCompact={() => compact()} compacting={d.compacting} />
          {s.todos.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={(wide ? showPlan : planSheet) ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={t("chat.plan")}
                  onClick={() => (wide ? setShowPlan(!showPlan) : setPlanSheet(true))}
                >
                  <ListChecksIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("chat.plan")}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
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
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-8 md:px-6 md:pt-8 md:pb-10">
              {d.messages.length === 0 && !d.streaming ? (
                <div className="py-16 text-center text-sm text-muted-foreground">{t("chat.empty")}</div>
              ) : (
                <Transcript
                  view={settings.value?.transcriptView ?? "compact"}
                  d={d}
                  onOpenSubagent={setSubagent}
                  onEdit={(seq, text) => setEditing({ seq, text, nonce: Date.now() })}
                  onFork={fork}
                  onRetry={() => rpc("chat.retry", { sessionId: s.id }).catch((e) => toast.error(e.message))}
                />
              )}
            </div>
          </div>
          {detached && (
            <Button variant="outline" size="icon-sm" aria-label={t("chat.jumpToLatest")} onClick={jump} className="absolute bottom-40 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md">
              <ArrowDownIcon />
            </Button>
          )}
          <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0.5rem,calc(var(--safe-bottom)-0.75rem))] md:px-6 md:pb-5">
            <div className="flex flex-col gap-2">
              {d.approvals.map((a) => (
                <ApprovalCard key={a.id} req={a} />
              ))}
              {d.questions.map((q) => (
                <QuestionCard key={q.id} req={q} />
              ))}
              {d.queued.length > 0 && (
                <div className="flex flex-col gap-1">
                  {d.queued.map((q) => (
                    <div key={q.id} className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-1.5 text-xs">
                      <span className="shrink-0 text-muted-foreground">{q.mode === "steer" ? t("chat.queuedSteer") : t("chat.queuedFollow")}</span>
                      <span className="min-w-0 flex-1 truncate">{q.text}</span>
                      <button type="button" className="text-muted-foreground hover:text-foreground pointer-coarse:-m-2 pointer-coarse:p-2" onClick={() => rpc("chat.cancelQueued", { sessionId: s.id, id: q.id })}>
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
                  <button type="button" className="ml-auto hover:underline pointer-coarse:-my-2 pointer-coarse:py-2" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              )}
              <Composer
                cwd={s.cwd}
                running={running}
                draftKey={draftKeyForHost(s.id)}
                history={history}
                autoFocus
                initial={editing ? { text: editing.text, nonce: editing.nonce } : null}
                onSubmit={send}
                onAbort={() => rpc("chat.abort", { sessionId: s.id })}
                onBuiltin={onBuiltin}
                folder={s.messageCount === 0 ? { value: shortPath(s.cwd, appInfo.value?.home), onChange: (cwd) => update({ cwd }) } : undefined}
                toolbarStart={<PermissionPicker value={s.permissionMode} onChange={(v: PermissionMode) => update({ permissionMode: v })} />}
                toolbarEnd={
                  <ModelControl
                    providerId={s.providerId}
                    modelId={s.modelId}
                    onChange={(providerId, modelId) => update({ providerId, modelId })}
                    thinking={s.thinking}
                    onThinking={(v: ThinkingLevel) => update({ thinking: v })}
                  />
                }
              />
            </div>
          </div>
        </div>
        {wide && showPlan && s.todos.length > 0 && (
          <aside className="w-72 shrink-0 border-l bg-sidebar/40">
            <PlanPanel todos={s.todos} />
          </aside>
        )}
      </div>
      <Sheet open={!wide && planSheet && s.todos.length > 0} onOpenChange={setPlanSheet}>
        <SheetContent className="w-[min(22rem,88vw)] gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("chat.plan")}</SheetTitle>
            <SheetDescription>{t("chat.plan")}</SheetDescription>
          </SheetHeader>
          <PlanPanel todos={s.todos} />
        </SheetContent>
      </Sheet>
      <SubagentSheet id={subagent} onClose={() => setSubagent(null)} />
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
