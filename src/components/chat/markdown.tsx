// Sanitized Markdown with a lightweight reveal on newly streamed text only.
import { memo } from "preact/compat"
import { useTextReveal } from "@/hooks/use-text-reveal"
import { renderMarkdown } from "@/lib/markdown"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

function onClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null
  if (!btn) return
  const code = btn.closest("pre")?.querySelector("code")?.textContent ?? ""
  navigator.clipboard.writeText(code)
  btn.textContent = t("common.copied")
  setTimeout(() => (btn.textContent = t("common.copy")), 1200)
}

export const Markdown = memo(function Markdown({ text, className, streaming, breaks }: { text: string; className?: string; streaming?: boolean; breaks?: boolean }) {
  const ref = useTextReveal(!!streaming)
  return (
    <div
      ref={ref}
      className={cn("markdown text-[0.875rem]", className)}
      onClick={onClick as any}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { breaks }) }}
    />
  )
})
