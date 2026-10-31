// Viewing and editing one memory note: topic, type, description, aliases and content, saved against its revision.
import { useEffect, useState } from "preact/hooks"
import { ExternalLinkIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { MemoryEntry, MemoryEvidence, MemorySummary, MemoryType } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { rpc } from "@/lib/api"
import { t, type MessageKey } from "@/lib/i18n"
import { route, sessions } from "@/lib/store"

export const TYPES: MemoryType[] = ["user", "feedback", "project", "reference"]

export const MEMORY_DIR = "~/.kestrel/memory"

export interface Draft {
  topic: string
  name: string
  type: MemoryType
  description: string
  content: string
}

export const EMPTY: Draft = { topic: "", name: "", type: "user", description: "", content: "" }

// Mounted fresh for every open (the parent changes its key), so a new note never flashes the last one's fields.
export function MemoryDialog({ open, entry, topics, onClose }: { open: boolean; entry: MemorySummary | null; topics: string[]; onClose: () => void }) {
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
