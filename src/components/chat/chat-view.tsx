// One conversation: header, transcript (kept at the bottom while the agent writes), the dock under it, and the
// plan beside it. The parts are in session/; this holds what is open and sends messages.
import { useEffect, useMemo, useState } from "preact/hooks"
import { ArrowDownIcon } from "lucide-react"
import { toast } from "sonner"
import type { SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ConfirmDeleteDialog, MergeDialog, RenameDialog } from "@/components/session-dialogs"
import { rpc, stageAttachments, type StagedFile } from "@/lib/api"
import { detailSignal, enabledModels, findModel, loadDetail, settings } from "@/lib/store"
import { useStickToBottom } from "@/hooks/use-stick-to-bottom"
import { useMediaQuery } from "@/hooks/use-media-query"
import { t } from "@/lib/i18n"
import type { Attachment } from "./composer"
import { userText } from "./messages"
import { Transcript } from "./transcript"
import { sessionActions } from "./session/actions"
import { ChatDock, type Editing } from "./session/dock"
import { ChatHeader } from "./session/header"
import { folderMenu, sessionMenu } from "./session/menus"
import { PlanPanel, PlanSheet, SubagentSheet } from "./session/panels"

export function ChatView({ sessionId }: { sessionId: string }) {
  const d = detailSignal(sessionId).value
  const [subagent, setSubagent] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
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
  const lastSeq = d.messages[d.messages.length - 1]?.seq ?? -1
  const actions = sessionActions(s, lastSeq)

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        s={s}
        model={model}
        compacting={d.compacting}
        onCompact={() => actions.compact()}
        onRename={() => setRenaming(s)}
        folderMenu={folderMenu(s, actions)}
        sessionMenu={sessionMenu(s, { running, lastSeq, actions, rename: () => setRenaming(s), remove: () => setDeleting(s), merge: (target) => setMerging({ target }) })}
        planActive={wide ? showPlan : planSheet}
        onPlan={() => (wide ? setShowPlan(!showPlan) : setPlanSheet(true))}
      />

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
                  onFork={actions.fork}
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
          <ChatDock d={d} vision={model ? model.vision : true} history={history} editing={editing} onCancelEdit={() => setEditing(null)} onSend={send} actions={actions} />
        </div>
        {wide && showPlan && s.todos.length > 0 && (
          <aside className="w-72 shrink-0 border-l bg-sidebar/40">
            <PlanPanel todos={s.todos} />
          </aside>
        )}
      </div>
      <PlanSheet open={!wide && planSheet && s.todos.length > 0} onOpenChange={setPlanSheet} todos={s.todos} />
      <SubagentSheet id={subagent} onClose={() => setSubagent(null)} />
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
      <MergeDialog source={merging ? s : null} target={merging?.target} onClose={() => setMerging(null)} />
    </div>
  )
}
