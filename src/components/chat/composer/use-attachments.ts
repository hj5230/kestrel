// Pictures and files waiting to be sent with the next message. Pictures are prepared (resized, converted) as
// they are added; models that can't read images refuse them here rather than at send time.
import { useState } from "preact/hooks"
import { toast } from "sonner"
import { FILE_ATTACHMENT_MAX_BYTES } from "@shared/protocol"
import type { StagedFile } from "@/lib/api"
import { isImageName, prepareImage } from "@/lib/images"
import { t } from "@/lib/i18n"

export interface Attachment {
  data: string
  mimeType: string
  name: string
}

const MAX = 8

export const isImageFile = (f: File) => f.type.startsWith("image/") || isImageName(f.name)

export function useAttachments(vision: boolean) {
  const [images, setImages] = useState<Attachment[]>([])
  const [files, setFiles] = useState<StagedFile[]>([])
  const [converting, setConverting] = useState(0)

  const addImages = async (list: FileList | File[]) => {
    const picked = [...list].filter(isImageFile)
    if (!picked.length) return
    if (!vision) {
      toast.error(t("composer.noVision"))
      return
    }
    setConverting((n) => n + picked.length)
    // Each picture is resized or converted on its own, so one unreadable file doesn't drop the rest.
    await Promise.all(
      picked.map((f) =>
        prepareImage(f)
          .then((img) => setImages((cur) => [...cur, img].slice(0, MAX)))
          .catch((e: any) => toast.error(`${f.name || t("common.image")}: ${e?.message ?? String(e)}`))
          .finally(() => setConverting((n) => n - 1)),
      ),
    )
  }

  const stage = (next: StagedFile[]) => {
    if (next.length) setFiles((cur) => [...cur, ...next].slice(0, MAX))
  }

  const addFiles = (list: FileList | File[]) => {
    const next = [...list].filter((f) => !isImageFile(f))
    if (next.some((f) => f.size > FILE_ATTACHMENT_MAX_BYTES)) toast.error(t("composer.fileTooLarge"))
    stage(next.filter((f) => f.size <= FILE_ATTACHMENT_MAX_BYTES).map((file) => ({ name: file.name, size: file.size, file })))
  }

  return {
    images,
    files,
    converting,
    addImages,
    addFiles,
    stage,
    removeImage: (i: number) => setImages((cur) => cur.filter((_, j) => j !== i)),
    removeFile: (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i)),
    /** Takes everything out for sending; `restore` puts it back if the send fails. */
    take: () => {
      const taken = { images, files }
      setImages([])
      setFiles([])
      return taken
    },
    restore: (taken: { images: Attachment[]; files: StagedFile[] }) => {
      setImages(taken.images)
      setFiles(taken.files)
    },
  }
}
