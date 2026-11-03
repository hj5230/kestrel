// A read-only subagent transcript opened from a tool result.
import { useEffect } from "preact/hooks"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { detailSignal, loadDetail, settings } from "@/lib/store"
import { t } from "@/lib/i18n"
import { Transcript } from "../transcript"

export function SubagentSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const sig = id ? detailSignal(id) : null
  useEffect(() => {
    if (id) loadDetail(id).catch(() => {})
  }, [id])
  const d = sig?.value
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(720px,92vw)] gap-0 sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>{d?.session.title ?? t("chat.subagent")}</SheetTitle>
          <SheetDescription>{t("chat.subagentDesc")}</SheetDescription>
        </SheetHeader>
        <div data-transcript-scroll className="flex-1 overflow-y-auto px-6 py-5">{d ? <Transcript d={d} view={settings.value?.transcriptView ?? "compact"} readOnly /> : <Spinner />}</div>
      </SheetContent>
    </Sheet>
  )
}
