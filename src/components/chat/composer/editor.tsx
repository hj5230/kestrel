// The input itself: a transparent textarea over a highlighted copy of its text (source.ts). The textarea
// owns everything the system gives a native field (caret, selection, IME, dictation, autocorrect, undo);
// the copy only paints. For the two to stay in line they share one box class, one width and one scroll
// position, and both keep a scrollbar gutter so the textarea's scrollbar can't narrow it alone.
import type { RefObject } from "preact"
import { t } from "@/lib/i18n"
import { highlightMarkdownSource } from "./source"
import { isImageFile } from "./use-attachments"

// 16px on touch screens: iOS zooms into any smaller field when it is focused.
const BOX = "px-4 py-3 pointer-coarse:py-4 text-[0.94rem] pointer-coarse:text-base leading-relaxed break-words whitespace-pre-wrap [scrollbar-gutter:stable]"

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
  const caret = (e: { currentTarget: HTMLTextAreaElement }) => onCaret(e.currentTarget.selectionStart ?? 0)
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
        spellcheck={false}
        data-slot="composer-input"
        className={`relative block max-h-80 w-full resize-none bg-transparent ${BOX} text-transparent caret-foreground outline-none selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground/70`}
        onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
        onInput={(e) => onText(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown as any}
        onKeyUp={caret}
        onClick={caret}
        onSelect={caret}
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
