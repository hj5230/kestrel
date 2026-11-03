// Everything under the transcript: approvals waiting for the user, queued messages, the edit banner and the composer.
import { PencilIcon, XIcon } from "lucide-react"
import type { PermissionMode, ThinkingLevel } from "@shared/protocol"
import { rpc, type StagedFile } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { appInfo, draftKeyForHost, type DetailState } from "@/lib/store"
import { t } from "@/lib/i18n"
import { ApprovalCard } from "../approval-card"
import { Composer, type Attachment } from "../composer"
import { ModelControl, PermissionPicker } from "../pickers"
import type { SessionActions } from "./actions"
import { MergeStatus } from "./merge-status"

export interface Editing {
  seq: number
  text: string
  nonce: number
}

export function ChatDock({
  d,
  vision,
  history,
  editing,
  onCancelEdit,
  onSend,
  actions,
}: {
  d: DetailState
  vision: boolean
  history: string[]
  editing: Editing | null
  onCancelEdit: () => void
  onSend: (text: string, images: Attachment[], files: StagedFile[]) => Promise<boolean | void>
  actions: SessionActions
}) {
  const s = d.session
  const running = s.status === "running" || s.status === "waiting"
  return (
    <div data-keyboard-dock className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0px,calc(var(--safe-bottom)-1.25rem))] md:px-6">
      <div className="flex flex-col gap-2">
        <MergeStatus sessionId={s.id} />
        {d.approvals.map((a) => (
          <ApprovalCard key={a.id} req={a} />
        ))}
        {d.queued.length > 0 && (
          <div className="flex flex-col gap-1">
            {d.queued.map((q) => (
              <div key={q.id} className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-1.5 text-xs">
                <span className="shrink-0 text-muted-foreground">{q.mode === "steer" ? t("chat.queuedSteer") : t("chat.queuedFollow")}</span>
                <span className="min-w-0 flex-1 truncate">{q.text}</span>
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  className="text-muted-foreground hover:text-foreground pointer-coarse:-m-2 pointer-coarse:p-2"
                  onClick={() => rpc("chat.cancelQueued", { sessionId: s.id, id: q.id })}
                >
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
            <button type="button" className="ml-auto hover:underline pointer-coarse:-my-2 pointer-coarse:py-2" onClick={onCancelEdit}>
              {t("common.cancel")}
            </button>
          </div>
        )}
        <Composer
          cwd={s.cwd}
          running={running}
          draftKey={draftKeyForHost(s.id)}
          vision={vision}
          history={history}
          autoFocus
          initial={editing ? { text: editing.text, nonce: editing.nonce } : null}
          onSubmit={onSend}
          onAbort={() => rpc("chat.abort", { sessionId: s.id })}
          onBuiltin={actions.builtin}
          folder={s.messageCount === 0 ? { value: shortPath(s.cwd, appInfo.value?.home), onChange: (cwd) => actions.update({ cwd }) } : undefined}
          toolbarStart={<PermissionPicker value={s.permissionMode} onChange={(v: PermissionMode) => actions.update({ permissionMode: v })} />}
          toolbarEnd={
            <ModelControl
              providerId={s.providerId}
              modelId={s.modelId}
              onChange={(providerId, modelId) => actions.update({ providerId, modelId })}
              thinking={s.thinking}
              onThinking={(v: ThinkingLevel) => actions.update({ thinking: v })}
            />
          }
        />
      </div>
    </div>
  )
}
