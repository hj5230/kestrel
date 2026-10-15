import { useState } from "preact/hooks"
import { ShieldQuestionIcon } from "lucide-react"
import type { ApprovalDecision, ApprovalRequest } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DiffView, simpleDiff } from "./diff-view"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { appInfo } from "@/lib/store"
import { toast } from "sonner"

export function ApprovalCard({ req }: { req: ApprovalRequest }) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const respond = async (decision: ApprovalDecision, note?: string) => {
    setBusy(true)
    try {
      await rpc("approvals.respond", { id: req.id, decision, reason: note })
    } catch (e: any) {
      toast.error(e.message)
      setBusy(false)
    }
  }
  const args = req.args ?? {}
  const isEdit = req.toolName === "edit" || req.toolName === "write"
  const rule = req.ruleSuggestion
  return (
    <div className="overflow-hidden rounded-xl border border-warning/40 bg-card shadow-sm ring-4 ring-warning/10">
      <div className="flex items-center gap-2 border-b bg-warning/10 px-4 py-2.5">
        <ShieldQuestionIcon className="size-4 text-warning" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{req.title.replace(args.path ?? "\u0000", shortPath(String(args.path ?? ""), appInfo.value?.home))}</span>
      </div>
      <div className="max-h-72 overflow-auto bg-code">
        {isEdit ? (
          <DiffView diff={req.toolName === "edit" ? simpleDiff(args.old_string ?? "", args.new_string ?? "") : simpleDiff("", String(args.content ?? "").slice(0, 6000))} maxHeight={288} />
        ) : (
          <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
            {req.toolName === "bash" && <span className="select-none text-muted-foreground">$ </span>}
            {req.detail}
          </pre>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
        <Button size="sm" disabled={busy} onClick={() => respond("allow_once")}>
          允许
        </Button>
        {rule && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => respond("allow_session")} title={rule}>
            本会话内允许 <span className="max-w-40 truncate font-mono text-[11px] opacity-70">{rule}</span>
          </Button>
        )}
        {rule && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => respond("allow_always")}>
            此项目始终允许
          </Button>
        )}
        <div className="flex-1" />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy}>
              拒绝…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                respond("deny", reason.trim() || undefined)
              }}
            >
              <div className="text-sm font-medium">拒绝并告诉 Helm 原因（可选）</div>
              <Input autoFocus value={reason} onInput={(e) => setReason(e.currentTarget.value)} placeholder="例如：先别改这个文件，改用…" />
              <div className="flex justify-end">
                <Button size="sm" variant="destructive" type="submit">
                  拒绝
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
