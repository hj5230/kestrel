// Lines across the transcript where its history changed: a compaction, or another session merged in.
import { useState } from "preact/hooks"
import { GitMergeIcon, ShrinkIcon } from "lucide-react"
import type { CompactionInfo, UserMsg } from "@shared/protocol"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Markdown } from "./markdown"
import { formatTokens } from "@/lib/format"
import { t } from "@/lib/i18n"

/** A session merged into this one: one quiet line in the transcript, the summary the model received on click. */
export function MergeNote({ merge }: { merge: NonNullable<UserMsg["merge"]> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted pointer-coarse:min-h-9">
          <GitMergeIcon className="size-3 shrink-0" />
          <span className="truncate">{t("msg.merged", { title: merge.title, n: merge.messages })}</span>
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("msg.mergedTitle", { title: merge.title })}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-2">
            <Markdown text={merge.summary} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CompactionDivider({ c }: { c: CompactionInfo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted pointer-coarse:min-h-9">
          <ShrinkIcon className="size-3" />
          {c.auto ? t("msg.autoCompacted") : t("msg.compacted")} · {t("msg.compactedFrom", { n: formatTokens(c.tokensBefore) })}
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("msg.summary")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto pr-2">
            <Markdown text={c.summary} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
