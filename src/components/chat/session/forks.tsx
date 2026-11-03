// The end of a session that has forks: one row per live branch, so it can be opened or merged back without
// going through the sidebar.
import { GitBranchIcon, GitMergeIcon } from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { relativeTime } from "@/lib/format"
import { openSession, sessions } from "@/lib/store"
import { t } from "@/lib/i18n"

export function ForkList({ s, onMerge }: { s: SessionInfo; onMerge: (fork: SessionInfo) => void }) {
  const forks = sessions.value.filter((x) => x.forkOf === s.id)
  if (!forks.length) return null
  return (
    <div className="mt-6 overflow-hidden rounded-xl border">
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <GitBranchIcon className="size-3.5" />
        {t("chat.branches")}
      </div>
      <div className="divide-y">
        {forks.map((f) => {
          return (
            <div key={f.id} className="flex items-center gap-2 px-1.5 py-1">
              <button
                type="button"
                title={t("chat.openBranch")}
                onClick={() => openSession(f.id)}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted pointer-coarse:min-h-11"
              >
                <span className="truncate text-sm">{f.title || t("sidebar.branch")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(f.updatedAt)}</span>
              </button>
              <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => onMerge(f)}>
                <GitMergeIcon />
                {t("merge.action")}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
