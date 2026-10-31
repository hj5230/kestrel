import { useEffect, useMemo, useState } from "preact/hooks"
import {
  ArchiveIcon,
  ArrowDownIcon,
  ClipboardCopyIcon,
  EyeIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitMergeIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ShrinkIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { SessionInfo, ThinkingLevel, PermissionMode, TranscriptView } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { ActionMenu, type MenuNode } from "@/components/action-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ConfirmDeleteDialog, MergeDialog, RenameDialog } from "@/components/session-dialogs"
import { Composer, type Attachment } from "./composer"
import { ApprovalCard } from "./approval-card"
import { userText } from "./messages"
import { Transcript } from "./transcript"
import { VIEWS } from "./view-picker"
import { CwdBrowser, ModelControl, PermissionPicker } from "./pickers"
import { ContextMeter } from "./context-meter"
import { TodoList } from "./tool-call"
import { rpc, stageAttachments, type StagedFile } from "@/lib/api"
import { isMobileApp } from "@/lib/platform"
import { shortPath } from "@/lib/format"
import { appInfo, createSession, detailSignal, draftKeyForHost, enabledModels, findModel, loadDetail, openSession, route, sessions, settings, updateSettings } from "@/lib/store"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(t("common.copied")),
    (e) => toast.error(String(e?.message ?? e)),
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
        <div data-transcript-scroll className="flex-1 overflow-y-auto px-6 py-5">{d ? <Transcript d={d} view={settings.value?.transcriptView ?? "compact"} readOnly /> : <Spinner />}</div>
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
  const [merging, setMerging] = useState<{ target: SessionInfo | null } | null>(null)
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

  const exportMd = async () => (await import("@/lib/download")).downloadText(`${s.title || "session"}.md`, await rpc<string>("sessions.export", { id: s.id }))
  const archive = async () => {
    await rpc("sessions.update", { id: s.id, patch: { archived: true } }).catch((e) => toast.error(e.message))
    route.value = { name: "home" }
    toast.success(t("sidebar.archivedToast"))
  }
  const home = appInfo.value?.home
  const view = settings.value?.transcriptView ?? "compact"

  const forkSource = s.forkOf ? sessions.value.find((x) => x.id === s.forkOf) : undefined
  const sessionMenu: MenuNode[] = [
    { kind: "item", label: t("common.rename"), icon: PencilIcon, onSelect: () => setRenaming(s) },
    { kind: "item", label: t("chat.compact"), icon: ShrinkIcon, onSelect: () => compact(), disabled: running },
    { kind: "item", label: t("chat.fork"), icon: GitBranchIcon, onSelect: () => fork(d.messages[d.messages.length - 1]?.seq ?? -1) },
    {
      kind: "radio",
      label: t("view.label"),
      icon: EyeIcon,
      value: view,
      options: VIEWS.map((v) => ({ value: v.value, label: t(`view.${v.value}` as MessageKey), desc: t(`view.${v.value}.desc` as MessageKey) })),
      onChange: (v) => updateSettings({ transcriptView: v as TranscriptView }).catch((e) => toast.error(e.message)),
    },
    {
      kind: "sub",
      label: t("chat.copyTranscript"),
      icon: ClipboardCopyIcon,
      children: [
        { kind: "item", label: t("chat.copyMarkdown"), onSelect: () => rpc<string>("sessions.export", { id: s.id }).then(copy, (e) => toast.error(e.message)) },
        { kind: "item", label: t("chat.copyJsonl"), onSelect: () => rpc<string>("sessions.jsonl", { id: s.id }).then(copy, (e) => toast.error(e.message)) },
        // Kestrel keeps sessions as rows in its SQLite database, not one transcript file per session like
        // Claude Code's JSONL, so there is no path to copy. Kept visible and disabled until sessions are files.
        { kind: "item", label: t("chat.copySessionPath"), onSelect: () => {}, disabled: true },
      ],
    },
    ...(forkSource ? [{ kind: "item" as const, label: t("sidebar.mergeToMain"), icon: GitMergeIcon, onSelect: () => setMerging({ target: forkSource }), disabled: running }] : []),
    { kind: "item", label: t("sidebar.mergeInto"), icon: GitMergeIcon, onSelect: () => setMerging({ target: null }), disabled: running },
    { kind: "item", label: t("sidebar.archive"), icon: ArchiveIcon, onSelect: archive },
    { kind: "separator" },
    { kind: "item", label: t("chat.delete"), icon: Trash2Icon, destructive: true, onSelect: () => setDeleting(s) },
  ]

  // The folder can only change before the first message: after that the transcript refers to its files.
  // The entry stays visible, disabled, so it's clear why it can't be used.
  const folderMenu: MenuNode[] = [
    {
      kind: "panel",
      label: t("chat.changeDir"),
      icon: FolderInputIcon,
      disabled: s.messageCount > 0,
      className: "w-[min(24rem,calc(100vw-1.5rem))]",
      render: (close) => <CwdBrowser value={shortPath(s.cwd, home)} onChange={(cwd) => update({ cwd })} onDone={close} />,
    },
    // The folder lives on the Mac; a phone has no Finder to show it in.
    ...(isMobileApp ? [] : [{ kind: "item" as const, label: t("chat.openInFinder"), icon: FolderOpenIcon, onSelect: () => rpc("app.open", { path: s.cwd }) }]),
    {
      kind: "sub",
      label: t("chat.copyPath"),
      icon: ClipboardCopyIcon,
      children: [
        { kind: "item", label: t("chat.copyPathHome"), onSelect: () => copy(shortPath(s.cwd, home)) },
        { kind: "item", label: t("chat.copyPathRoot"), onSelect: () => copy(s.cwd) },
      ],
    },
  ]

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
        <ActionMenu
          title={t("chat.folder")}
          align="start"
          anchorClassName="min-w-0 shrink"
          nodes={folderMenu}
          trigger={
            <button
              type="button"
              aria-label={t("chat.folder")}
              className="flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted pointer-coarse:min-h-10"
            >
              <FolderIcon className="size-3.5 shrink-0" />
              <span className="truncate font-mono max-sm:hidden">{shortPath(s.cwd, home)}</span>
            </button>
          }
        />
        <div className="ml-auto flex items-center gap-1">
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
          <ActionMenu
            title={t("common.moreActions")}
            nodes={sessionMenu}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
                <MoreHorizontalIcon />
              </Button>
            }
          />
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={ref} data-transcript-scroll className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0.25rem,calc(var(--safe-bottom)-1rem))] md:px-6 md:pb-3">
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
                vision={model ? model.vision : true}
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
      <MergeDialog source={merging ? s : null} target={merging?.target} onClose={() => setMerging(null)} />
    </div>
  )
}
