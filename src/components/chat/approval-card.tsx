import { useState } from "preact/hooks"
import { PencilIcon, ShieldAlertIcon, ShieldQuestionIcon } from "lucide-react"
import { toast } from "sonner"
import type { ApprovalDecision, ApprovalNote, ApprovalRequest } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DiffView, simpleDiff } from "./diff-view"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { appInfo } from "@/lib/store"

function title(req: ApprovalRequest) {
  const path = shortPath(req.path ?? "", appInfo.value?.home)
  const base =
    req.kind === "bash"
      ? req.args?.description
        ? `${t("approval.runCommand")}: ${req.args.description}`
        : t("approval.runCommand")
      : req.kind === "edit"
        ? t(req.toolName === "write" ? "approval.write" : "approval.edit", { path })
        : req.toolName === "kill_shell"
          ? t("approval.killShell")
          : t("approval.callTool", { tool: req.toolName.replace(/^mcp__/, "").replace("__", " · ") })
  return (req.subagent ? t("approval.subagent") : "") + base
}

/** A rule as the button shows it: `=` (exact command) is notation, not part of the command. */
const ruleLabel = (rule: string) => {
  const r = rule.replace(/^=\s*/, "")
  return r.length > 40 ? r.slice(0, 39) + "…" : r
}

const NOTES: Record<ApprovalNote["code"], MessageKey> = {
  protected_path: "approval.note.protected_path",
  sensitive_read: "approval.note.sensitive_read",
  critical_delete: "approval.note.critical_delete",
  outside_project: "approval.note.outside_project",
  review_blocked: "approval.note.review_blocked",
  review_error: "approval.note.review_error",
}

export function ApprovalCard({ req }: { req: ApprovalRequest }) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const [pattern, setPattern] = useState(req.whitelistSuggestion ?? "")
  const respond = async (decision: ApprovalDecision, extra: { reason?: string; pattern?: string } = {}) => {
    setBusy(true)
    try {
      await rpc("approvals.respond", { id: req.id, decision, ...extra })
    } catch (e: any) {
      toast.error(e.message)
      setBusy(false)
    }
  }
  const args = req.args ?? {}
  return (
    <div className="overflow-hidden rounded-xl border border-warning/40 bg-card shadow-sm ring-4 ring-warning/10">
      <div className="flex items-center gap-2 border-b bg-warning/10 px-4 py-2.5">
        <ShieldQuestionIcon className="size-4 text-warning" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title(req)}</span>
      </div>
      {req.note && (
        <div className="flex gap-2 border-b bg-warning/5 px-4 py-2 text-xs text-muted-foreground">
          <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{t(NOTES[req.note.code], { detail: req.note.detail ?? "" })}</span>
        </div>
      )}
      <div className="max-h-72 overflow-auto bg-code">
        {req.kind === "edit" ? (
          <DiffView
            diff={req.toolName === "edit" ? simpleDiff(args.old_string ?? "", args.new_string ?? "") : simpleDiff("", String(args.content ?? "").slice(0, 6000))}
            maxHeight={288}
          />
        ) : (
          <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">
            {req.kind === "bash" && <span className="select-none text-muted-foreground">$ </span>}
            {req.detail}
          </pre>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
        <Button size="sm" disabled={busy} onClick={() => respond("allow_once")}>
          {t("approval.allow")}
        </Button>
        {req.whitelistSuggestion && (
          // One click remembers the suggested rule; the pencil lets the user widen or narrow it first.
          <Button size="sm" variant="secondary" disabled={busy} className="max-w-full min-w-0" onClick={() => respond("allow_always", { pattern: req.whitelistSuggestion! })}>
            <span className="truncate">{t("approval.always", { rule: ruleLabel(req.whitelistSuggestion) })}</span>
          </Button>
        )}
        {req.whitelistSuggestion && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={t("approval.editRule")}>
                <PencilIcon />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (pattern.trim()) respond("allow_always", { pattern: pattern.trim() })
                }}
              >
                <div className="text-sm font-medium">{t("approval.whitelistTitle")}</div>
                <div className="text-xs text-muted-foreground">{t(req.kind !== "bash" ? "approval.whitelistDescTool" : pattern.trim().startsWith("=") ? "approval.whitelistDescExact" : "approval.whitelistDescBash")}</div>
                <Input autoFocus className="font-mono text-xs" value={pattern} onInput={(e) => setPattern(e.currentTarget.value)} />
                <div className="flex justify-end">
                  <Button size="sm" type="submit" disabled={!pattern.trim()}>
                    {t("approval.whitelistConfirm")}
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        )}
        <div className="flex-1" />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy}>
              {t("approval.deny")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                respond("deny", { reason: reason.trim() || undefined })
              }}
            >
              <div className="text-sm font-medium">{t("approval.denyTitle")}</div>
              <Input autoFocus value={reason} onInput={(e) => setReason(e.currentTarget.value)} placeholder={t("approval.denyPlaceholder")} />
              <div className="flex justify-end">
                <Button size="sm" variant="destructive" type="submit">
                  {t("common.deny")}
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
