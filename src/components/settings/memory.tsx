import { useEffect, useMemo, useState } from "preact/hooks"
import { BrainIcon, ExternalLinkIcon, FolderOpenIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { AppSettings, HistoryStatus, MemoryEntry, MemoryEvidence, MemorySummary, MemoryType } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { MemoryModels } from "./memory-models"
import { Panel, Row, Section } from "./layout"
import { rpc } from "@/lib/api"
import { relativeTime } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { isMobileApp } from "@/lib/platform"
import { memoryRev, route, sessions, updateSettings } from "@/lib/store"

const TYPES: MemoryType[] = ["user", "feedback", "project", "reference"]

const MEMORY_DIR = "~/.kestrel/memory"

interface Draft {
  topic: string
  name: string
  type: MemoryType
  description: string
  content: string
}

const EMPTY: Draft = { topic: "", name: "", type: "user", description: "", content: "" }

// Mounted fresh for every open (the parent changes its key), so a new note never flashes the last one's fields.
function MemoryDialog({ open, entry, topics, onClose }: { open: boolean; entry: MemorySummary | null; topics: string[]; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(
    entry ? { topic: entry.topic, name: entry.name, type: entry.type, description: entry.description, content: "" } : EMPTY,
  )
  const [revision, setRevision] = useState(entry?.revision)
  const [evidence, setEvidence] = useState<MemoryEvidence[]>([])
  const [loading, setLoading] = useState(!!entry)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  // The list carries no content, so an existing note's text is fetched when its dialog opens.
  useEffect(() => {
    if (!entry) return
    rpc<MemoryEntry>("memory.get", { id: entry.id })
      .then((m) => { set({ topic: m.topic, name: m.name, type: m.type, description: m.description, content: m.content }); setRevision(m.revision); setEvidence(m.evidence) })
      .catch((e) => (toast.error(e.message), onClose()))
      .finally(() => setLoading(false))
  }, [])

  const save = async (e: Event) => {
    e.preventDefault()
    setSaving(true)
    try {
      await rpc("memory.save", { input: draft, from: entry?.id, revision })
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!entry) return
    try {
      await rpc("memory.delete", { id: entry.id })
      toast.success(t("memory.deleted"))
      setConfirmDelete(false)
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const session = entry?.source ? sessions.value.find((s) => s.id === entry.source) : undefined

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={save} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{entry ? t("memory.edit") : t("memory.add")}</DialogTitle>
              <DialogDescription>{t("memory.dialogDesc")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("memory.topic")}</FieldLabel>
                  <Input list="memory-topics" value={draft.topic} onInput={(e) => set({ topic: e.currentTarget.value })} placeholder="preferences" required />
                  <datalist id="memory-topics">
                    {topics.map((tp) => (
                      <option key={tp} value={tp} />
                    ))}
                  </datalist>
                </Field>
                <Field>
                  <FieldLabel>{t("common.name")}</FieldLabel>
                  <Input value={draft.name} onInput={(e) => set({ name: e.currentTarget.value })} placeholder="prefers-pnpm" required />
                </Field>
              </div>
              <Field>
                <FieldLabel>{t("memory.type")}</FieldLabel>
                <Select value={draft.type} onValueChange={(v) => set({ type: v as MemoryType })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((ty) => (
                      <SelectItem key={ty} value={ty}>
                        {t(`memory.type.${ty}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t(`memory.type.${draft.type}.desc` as MessageKey)}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t("memory.description")}</FieldLabel>
                <Input value={draft.description} maxLength={200} onInput={(e) => set({ description: e.currentTarget.value })} required />
                <FieldDescription>{t("memory.descriptionDesc")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>{t("memory.content")}</FieldLabel>
                <Textarea rows={8} value={draft.content} disabled={loading} onInput={(e) => set({ content: e.currentTarget.value })} required />
              </Field>
              {evidence.length > 0 && <div className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">{t("memory.evidence")}</p>
                {evidence.slice(-3).map((e) => <blockquote key={`${e.sessionId}:${e.seq}:${e.quote}`} className="border-l-2 pl-3 text-sm break-words">{e.quote}</blockquote>)}
              </div>}
              {session && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                  onClick={() => {
                    route.value = { name: "chat", sessionId: session.id }
                    onClose()
                  }}
                >
                  <ExternalLinkIcon />
                  {t("memory.fromSession", { title: session.title || t("common.untitled") })}
                </Button>
              )}
            </FieldGroup>
            <DialogFooter className="sm:justify-between">
              {entry ? (
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon />
                  {t("common.delete")}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={saving || loading}>
                  {saving && <Spinner />}
                  {t("common.save")}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("memory.deleteTitle", { id: entry?.locator ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("memory.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

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
