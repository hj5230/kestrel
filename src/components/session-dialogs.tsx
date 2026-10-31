import { useEffect, useState } from "preact/hooks"
import { ArchiveRestoreIcon, ArrowDownIcon, GitMergeIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import type { SessionInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { rpc } from "@/lib/api"
import { relativeTime, shortPath } from "@/lib/format"
import { Spinner } from "@/components/ui/spinner"
import { appInfo, openSession, refreshSessions, sessions } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

export function RenameDialog({ session, onClose }: { session: SessionInfo | null; onClose: () => void }) {
  const [title, setTitle] = useState("")
  useEffect(() => setTitle(session?.title ?? ""), [session])
  const submit = async (e?: Event) => {
    e?.preventDefault()
    if (!session) return
    await rpc("sessions.update", { id: session.id, patch: { title: title.trim() } })
    onClose()
  }
  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("dialog.renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder={t("dialog.renamePlaceholder")} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDeleteDialog({ session, onClose }: { session: SessionInfo | null; onClose: () => void }) {
  return (
    <AlertDialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialog.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dialog.deleteBody", { title: session?.title || t("common.untitled") })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              if (session) await rpc("sessions.delete", { id: session.id })
              onClose()
            }}
          >
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ArchivedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [items, setItems] = useState<SessionInfo[]>([])
  const load = () => rpc<SessionInfo[]>("sessions.list", { archived: true }).then(setItems)
  useEffect(() => {
    if (open) load()
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("dialog.archivedTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.archivedDesc")}</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[50vh] overflow-y-auto">
          {items.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle className="text-sm">{t("dialog.archivedEmpty")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            items.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.title || t("common.untitled")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.mergedInto
                      ? t("dialog.mergedInto", { title: sessions.value.find((x) => x.id === s.mergedInto)?.title || t("common.untitled") })
                      : shortPath(s.cwd, appInfo.value?.home)}{" "}
                    · {relativeTime(s.updatedAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t("common.restore")}
                  onClick={async () => {
                    await rpc("sessions.update", { id: s.id, patch: { archived: false } })
                    await Promise.all([load(), refreshSessions()])
                  }}
                >
                  <ArchiveRestoreIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t("common.delete")}
                  onClick={async () => {
                    await rpc("sessions.delete", { id: s.id })
                    load()
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Merging one session into another. With a target given ("Merge into main" on a fork) it only confirms;
 *  without one it first asks where to. The source is summarized into the target and then archived. */
export function MergeDialog({ source, target, onClose }: { source: SessionInfo | null; target?: SessionInfo | null; onClose: () => void }) {
  const [into, setInto] = useState<SessionInfo | null>(null)
  const [query, setQuery] = useState("")
  const [focus, setFocus] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setInto(target ?? null)
    setQuery("")
    setFocus("")
    setBusy(false)
  }, [source, target])
  const title = (s: SessionInfo) => s.title || t("common.untitled")
  const q = query.trim().toLowerCase()
  const candidates = sessions.value.filter((s) => s.id !== source?.id && (!q || title(s).toLowerCase().includes(q)))
  const branch = !!source && !!into && source.forkOf === into.id
  const submit = async (e?: Event) => {
    e?.preventDefault()
    if (!source || !into || busy) return
    setBusy(true)
    try {
      const merged = await rpc<SessionInfo>("sessions.merge", { id: source.id, into: into.id, instructions: focus })
      onClose()
      openSession(merged.id)
      toast.success(t("merge.done", { title: title(merged) }))
    } catch (err: any) {
      toast.error(err.message)
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <DialogHeader>
            <DialogTitle>{t("merge.title")}</DialogTitle>
            <DialogDescription>{into ? t(branch ? "merge.descBranch" : "merge.descWhole", { from: source ? title(source) : "", into: title(into) }) : t("merge.pick")}</DialogDescription>
          </DialogHeader>
          {!target && (
            <div className="grid gap-2">
              <Input value={query} onInput={(e) => setQuery(e.currentTarget.value)} placeholder={t("merge.search")} aria-label={t("merge.search")} />
              <div className="-mx-1 max-h-56 overflow-y-auto" role="listbox" aria-label={t("merge.into")}>
                {candidates.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t("merge.none")}</div>}
                {candidates.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={into?.id === s.id}
                    onClick={() => setInto(s)}
                    className={cn("flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted pointer-coarse:min-h-11", into?.id === s.id && "bg-accent text-accent-foreground hover:bg-accent")}
                  >
                    <span className="truncate text-sm">{title(s)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {shortPath(s.cwd, appInfo.value?.home)} · {relativeTime(s.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {target && source && (
            <div className="grid justify-items-start gap-1 rounded-lg border p-3 text-sm">
              <span className="max-w-full truncate text-muted-foreground">{title(source)}</span>
              <ArrowDownIcon className="size-3.5 text-muted-foreground" />
              <span className="max-w-full truncate font-medium">{title(target)}</span>
            </div>
          )}
          <Input value={focus} onInput={(e) => setFocus(e.currentTarget.value)} placeholder={t("merge.focus")} aria-label={t("merge.focus")} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!into || busy}>
              {busy ? <Spinner /> : <GitMergeIcon />}
              {busy ? t("merge.merging") : t("merge.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
