// The "+" under the input: add a picture, add a file, or (before the first message) pick the working folder.
// A popover on desktop, a bottom sheet on touch.
import { useRef, useState } from "preact/hooks"
import { toast } from "sonner"
import { ChevronLeftIcon, FolderIcon, ImagePlusIcon, PaperclipIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import type { StagedFile } from "@/lib/api"
import { pickFilePaths } from "@/lib/attach"
import { isTauri, isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import { CwdBrowser } from "../pickers"

const ITEM = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"

export function AddMenu({
  vision,
  folder,
  onImages,
  onFiles,
  onStage,
}: {
  vision: boolean
  folder?: { value: string; onChange: (v: string) => void }
  onImages: (files: FileList) => void
  onFiles: (files: FileList) => void
  /** Files picked by path in the native app; they are read on the Mac when the message is sent. */
  onStage: (files: StagedFile[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setPickingFolder(false)
  }
  /** Images use the webview's input, which offers Take Photo and the library on iOS and arrives as pixels for the model. Other files use the system document picker. */
  const chooseImage = () => {
    setOpen(false)
    imageInput.current?.click()
  }
  const chooseFile = async () => {
    setOpen(false)
    if (!isTauri) {
      fileInput.current?.click()
      return
    }
    try {
      const paths = await pickFilePaths()
      if (paths?.length) onStage(paths.map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })))
    } catch (e: any) {
      toast.error(e?.message ?? String(e))
    }
  }

  const trigger = (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground pointer-coarse:min-h-10 pointer-coarse:min-w-10" aria-label={t("composer.add")}>
      <PlusIcon />
    </Button>
  )
  const panel =
    pickingFolder && folder ? (
      <div>
        <button type="button" className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" onClick={() => setPickingFolder(false)}>
          <ChevronLeftIcon className="size-4" />
          {t("composer.folder")}
        </button>
        <CwdBrowser value={folder.value} onChange={folder.onChange} onDone={() => close(false)} />
      </div>
    ) : (
      <div className="grid p-1">
        <button type="button" disabled={!vision} title={vision ? undefined : t("composer.noVision")} className={cn(ITEM, "disabled:pointer-events-none disabled:opacity-50")} onClick={chooseImage}>
          <ImagePlusIcon className="size-4 text-muted-foreground" />
          {t("composer.addImage")}
        </button>
        <button type="button" className={ITEM} onClick={chooseFile}>
          <PaperclipIcon className="size-4 text-muted-foreground" />
          {t("composer.addFile")}
        </button>
        {folder && (
          <button type="button" className={cn(ITEM, "w-full min-w-0")} onClick={() => setPickingFolder(true)}>
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0">{t("composer.folder")}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{folder.value || "~"}</span>
          </button>
        )}
      </div>
    )

  const input = (ref: typeof imageInput, onPick: (files: FileList) => void, accept?: string) => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.currentTarget.files) onPick(e.currentTarget.files)
        e.currentTarget.value = ""
      }}
    />
  )

  return (
    <>
      {isTouch ? (
        <Sheet open={open} onOpenChange={close}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" showCloseButton={false} className="max-h-[75vh] gap-0 rounded-t-2xl p-1">
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={close}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" side="top" className={cn("p-0", pickingFolder ? "w-[min(24rem,calc(100vw-1.5rem))]" : "w-64")}>
            {panel}
          </PopoverContent>
        </Popover>
      )}
      {input(imageInput, onImages, "image/*,.heic,.heif")}
      {input(fileInput, onFiles)}
    </>
  )
}
