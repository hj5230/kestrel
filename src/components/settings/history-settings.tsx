// Which other apps' conversations are indexed for search, and the state of that index.
import { useEffect, useState } from "preact/hooks"
import { toast } from "sonner"
import type { AppSettings, HistoryStatus } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { Panel, Row, Section } from "./layout"
import { rpc } from "@/lib/api"
import { t } from "@/lib/i18n"
import { updateSettings } from "@/lib/store"

/** Which other apps' conversations the agent may search, and how far their indexing has got. */
export function HistorySettings({ s }: { s: AppSettings }) {
  const [status, setStatus] = useState<HistoryStatus | null>(null)
  const indexing = !!status?.indexing
  useEffect(() => {
    let live = true
    const load = () =>
      rpc<HistoryStatus>("history.status")
        .then((r) => live && setStatus(r))
        .catch(() => {})
    load()
    const timer = setInterval(load, indexing ? 1500 : 6000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [indexing, s.historySources.join()])

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...s.historySources, id] : s.historySources.filter((x) => x !== id)
    updateSettings({ historySources: next }).catch((e) => toast.error(e.message))
  }

  return (
    <Section
      title={t("history.title")}
      desc={t("history.desc")}
      action={
        <Button variant="outline" size="sm" disabled={indexing} onClick={() => rpc("history.rebuild").then(() => setStatus((r) => r && { ...r, indexing: true })).catch((e) => toast.error(e.message))}>
          {indexing && <Spinner />}
          {t("history.reindex")}
        </Button>
      }
    >
      <Panel>
        {(status?.sources ?? []).map((src) => (
          <Row
            key={src.id}
            label={src.label}
            desc={
              <>
                <span className="font-mono">{src.root}</span>
                <span className="mt-0.5 block text-[11px]">
                  {!src.found ? t("history.notFound") : src.enabled ? (indexing ? t("history.indexing", { done: status!.progress.done, total: status!.progress.total }) : t("history.found", { n: src.sessions, m: src.messages })) : ""}
                </span>
              </>
            }
          >
            <Switch checked={src.enabled} disabled={!src.found && !src.enabled} onCheckedChange={(v) => toggle(src.id, v)} />
          </Row>
        ))}
      </Panel>
    </Section>
  )
}
