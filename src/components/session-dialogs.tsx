import { useEffect, useState } from "preact/hooks"
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react"
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
import { appInfo, refreshSessions } from "@/lib/store"
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
                    {shortPath(s.cwd, appInfo.value?.home)} · {relativeTime(s.updatedAt)}
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
