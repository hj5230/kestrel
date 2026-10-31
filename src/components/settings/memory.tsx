import { useEffect, useMemo, useState } from "preact/hooks"
import { BrainIcon, FolderOpenIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import type { AppSettings, MemorySummary } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { MemoryModels } from "./memory-models"
import { Panel, Row, Section } from "./layout"
import { rpc } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { isMobileApp } from "@/lib/platform"
import { memoryRev, updateSettings } from "@/lib/store"
import { MEMORY_DIR, MemoryDialog } from "./memory-dialog"
export { HistorySettings } from "./history-settings"

export function MemorySettings({ s }: { s: AppSettings }) {
  const [list, setList] = useState<MemorySummary[] | null>(null)
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<MemorySummary | null>(null)
  const [dialog, setDialog] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)

  // Reloads on mount and whenever the agent (or another window) changes a note.
  useEffect(() => {
    rpc<MemorySummary[]>("memory.list")
      .then(setList)
      .catch((e) => toast.error(e.message))
  }, [memoryRev.value])

  const topics = useMemo(() => [...new Set((list ?? []).map((m) => m.topic))], [list])
  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const shown = (list ?? []).filter((m) => !needle || `${m.locator} ${m.description}`.toLowerCase().includes(needle))
    const byTopic = new Map<string, MemorySummary[]>()
    for (const m of shown) byTopic.set(m.topic, [...(byTopic.get(m.topic) ?? []), m])
    return [...byTopic.entries()]
  }, [list, q])

  const open = (m: MemorySummary | null) => {
    setEditing(m)
    setDialogKey((k) => k + 1)
    setDialog(true)
  }

  return (
    <div className="grid gap-8">
      <Section title={t("memory.title")} desc={t("memory.desc")}>
        <Panel>
          <Row label={t("memory.enable")} desc={t("memory.enableDesc")}>
            <Switch checked={s.memoryEnabled} onCheckedChange={(v) => updateSettings({ memoryEnabled: v }).catch((e) => toast.error(e.message))} />
          </Row>
          <Row label={t("memory.autoSave")} desc={t("memory.autoSaveDesc")}>
            <Switch
              checked={s.memoryAutoSave}
              disabled={!s.memoryEnabled}
              onCheckedChange={(v) => updateSettings({ memoryAutoSave: v }).catch((e) => toast.error(e.message))}
            />
          </Row>
        </Panel>
      </Section>

      <MemoryModels s={s} />

      <Section
        title={list ? t("memory.notesN", { n: list.length }) : t("memory.notes")}
        desc={t("memory.notesDesc", { dir: MEMORY_DIR })}
        action={
          <div className="flex flex-wrap gap-2">
            {list && list.length > 0 && <Input className="w-44" placeholder={t("memory.search")} value={q} onInput={(e) => setQ(e.currentTarget.value)} />}
            <Button size="sm" onClick={() => open(null)}>
              <PlusIcon />
              {t("memory.addNote")}
            </Button>
          </div>
        }
      >
        {list && list.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BrainIcon />
              </EmptyMedia>
              <EmptyTitle>{t("memory.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("memory.emptyDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          grouped.map(([topic, items]) => (
            <div key={topic} className="grid gap-1.5">
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {topic} · {items.length}
              </h3>
              <Panel>
                {items.map((m) => (
                  <button key={m.id} type="button" onClick={() => open(m)} className="block w-full text-left transition-colors hover:bg-muted/40">
                    <Row
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          {m.name}
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {t(`memory.type.${m.type}` as MessageKey)}
                          </Badge>
                        </span>
                      }
                      desc={
                        <>
                          <span className="line-clamp-2">{m.description}</span>
                          <span className="mt-0.5 block text-[11px]">{relativeTime(m.modifiedAt)}</span>
                        </>
                      }
                    />
                  </button>
                ))}
              </Panel>
            </div>
          ))
        )}
        {list && list.length > 0 && grouped.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t("memory.noMatch")}</p>}
        {!isMobileApp && list && list.length > 0 && (
          <div>
            <Button variant="outline" size="sm" onClick={() => rpc("app.open", { path: MEMORY_DIR })}>
              <FolderOpenIcon />
              {t("memory.openFolder")}
            </Button>
          </div>
        )}
      </Section>

      {dialogKey > 0 && <MemoryDialog key={dialogKey} open={dialog} entry={editing} topics={topics} onClose={() => setDialog(false)} />}
    </div>
  )
}
