// The input itself: a transparent textarea over a highlighted copy of its text. Same box, font and wrapping in
// both, so the caret, selection and IME stay the textarea's own while the Markdown shows in color.
import type { RefObject } from "preact"
import { t } from "@/lib/i18n"
import { highlightMarkdownSource } from "../md-source"
import { isImageFile } from "./use-attachments"

const BOX = "px-4 py-3 pointer-coarse:py-4 text-[0.94rem] leading-relaxed break-words whitespace-pre-wrap"

export function Editor({
  ta,
  mirror,
  text,
  placeholder,
  onText,
  onCaret,
  onKeyDown,
  onPasteImages,
}: {
  ta: RefObject<HTMLTextAreaElement | null>
  mirror: RefObject<HTMLDivElement | null>
  text: string
  placeholder?: string
  onText: (text: string, caret: number) => void
  onCaret: (caret: number) => void
  onKeyDown: (e: KeyboardEvent) => void
  onPasteImages: (files: File[]) => void
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={mirror}
        aria-hidden="true"
        className={`md-source pointer-events-none absolute inset-0 overflow-hidden ${BOX}`}
        dangerouslySetInnerHTML={{ __html: text ? highlightMarkdownSource(text) : "" }}
      />
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={placeholder ?? t("composer.placeholder")}
        className={`relative block max-h-80 w-full resize-none bg-transparent ${BOX} text-transparent caret-foreground outline-none selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground/70`}
        onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
        onInput={(e) => onText(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown as any}
        onKeyUp={(e) => onCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => onCaret(e.currentTarget.selectionStart ?? 0)}
        onPaste={(e) => {
          const images = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
          if (images.length) {
            e.preventDefault()
            onPasteImages(images)
          }
        }}
      />
    </div>
  )
}
