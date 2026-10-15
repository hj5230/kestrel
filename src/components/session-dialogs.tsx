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
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="会话标题" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
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
          <AlertDialogTitle>删除会话？</AlertDialogTitle>
          <AlertDialogDescription>
            「{session?.title || "新会话"}」及其全部消息和子代理记录将被永久删除，无法恢复。工作目录中的文件不受影响。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              if (session) await rpc("sessions.delete", { id: session.id })
              onClose()
            }}
          >
            删除
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
          <DialogTitle>已归档会话</DialogTitle>
          <DialogDescription>归档的会话不会出现在侧边栏，可随时恢复。</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 max-h-[50vh] overflow-y-auto">
          {items.length === 0 ? (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle className="text-sm">没有归档的会话</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            items.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.title || "新会话"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {shortPath(s.cwd, appInfo.value?.home)} · {relativeTime(s.updatedAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="恢复"
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
                  title="删除"
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
