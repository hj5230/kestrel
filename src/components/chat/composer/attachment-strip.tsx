// The row of pending pictures and files above the input, each removable.
import { FileIcon, XIcon } from "lucide-react"
import type { StagedFile } from "@/lib/api"
import { Spinner } from "@/components/ui/spinner"
import { t } from "@/lib/i18n"
import type { Attachment } from "./use-attachments"

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
}

export function AttachmentStrip({
  images,
  files,
  converting,
  onRemoveImage,
  onRemoveFile,
}: {
  images: Attachment[]
  files: StagedFile[]
  converting: number
  onRemoveImage: (i: number) => void
  onRemoveFile: (i: number) => void
}) {
  if (!images.length && !files.length && !converting) return null
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {converting > 0 && (
        <div className="flex size-16 items-center justify-center rounded-lg border text-muted-foreground" aria-label={t("composer.preparing")}>
          <Spinner />
        </div>
      )}
      {images.map((img, i) => (
        <div key={i} className="group/img relative">
          <img src={`data:${img.mimeType};base64,${img.data}`} className="size-16 rounded-lg border object-cover" />
          <button
            type="button"
            aria-label={t("common.remove")}
            onClick={() => onRemoveImage(i)}
            className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background shadow group-hover/img:flex pointer-coarse:-top-2.5 pointer-coarse:-right-2.5 pointer-coarse:flex pointer-coarse:size-7"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      {files.map((file, i) => (
        <div key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="max-w-40 truncate">{file.name}</span>
          {file.size != null && <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>}
          <button type="button" aria-label={t("common.remove")} onClick={() => onRemoveFile(i)} className="text-muted-foreground hover:text-foreground pointer-coarse:-m-1 pointer-coarse:p-1">
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
