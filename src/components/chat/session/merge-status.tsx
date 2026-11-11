// A merge belongs to the sidecar, not the dialog. Poll its durable status while either session is open.
import { useEffect, useState } from "preact/hooks"
import { GitMergeIcon } from "lucide-react"
import { toast } from "sonner"
import { rpc } from "@/lib/api"
import { loadDetail, openSession, refreshSessions, sessions } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

import type { MergeJob as Job } from "@shared/protocol"

export function MergeStatus({ sessionId }: { sessionId: string }) {
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    let stopped = false
    let fetching = false
    const known = new Map<string, string>()
    const refresh = async () => {
      if (fetching) return
      fetching = true
      try {
        const all = await rpc<Job[]>("sessions.mergeJobs")
        if (stopped) return
        const relevant = all.filter((j) => j.sourceId === sessionId || j.targetId === sessionId)
        for (const j of relevant) {
          const before = known.get(j.id)
          if (before && before !== j.state && j.state === "succeeded") {
            toast.success(t("merge.finished"))
            await Promise.all([refreshSessions(), loadDetail(sessionId)])
          }
          known.set(j.id, j.state)
        }
        setJobs(relevant.filter((j) => j.state !== "succeeded"))
      } catch {} finally { fetching = false }
    }
    void refresh()
    const timer = setInterval(refresh, 1500)
    return () => { stopped = true; clearInterval(timer) }
  }, [sessionId])
  if (!jobs.length) return null
  return (
    <div className="grid gap-2">
      {jobs.map((j) => {
        // Name the other session, so the line says where this one is going (or what is arriving);
        // the name opens it.
        const outgoing = j.sourceId === sessionId
        const otherId = outgoing ? j.targetId : j.sourceId
        const other = sessions.value.find((s) => s.id === otherId)
        const name = t(outgoing ? "merge.intoTitle" : "merge.fromTitle", { title: other?.title || t("common.untitled") })
        return (
          <div key={j.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
            <GitMergeIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1" title={j.error ?? undefined}>
              {t(j.state === "failed" ? "merge.failed" : j.state === "ready" ? "merge.ready" : j.state === "queued" ? "merge.queued" : "merge.running")}
              {" · "}
              {other ? <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => openSession(otherId)}>{name}</button> : name}
              {j.error && <span className="mt-1 block break-words text-destructive">{j.error}</span>}
            </span>
            {j.state === "failed" && <Button size="xs" variant="ghost" onClick={() => rpc("sessions.merge", { id: j.sourceId, into: j.targetId }).then(() => setJobs((old) => old.filter((x) => x.id !== j.id)), (e) => toast.error(e.message))}>{t("merge.retry")}</Button>}
          </div>
        )
      })}
    </div>
  )
}
