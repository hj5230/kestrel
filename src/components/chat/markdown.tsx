import { memo } from "preact/compat"
import { renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

function onClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest("[data-copy]") as HTMLElement | null
  if (!btn) return
  const code = btn.closest("pre")?.querySelector("code")?.textContent ?? ""
  navigator.clipboard.writeText(code)
  btn.textContent = "已复制"
  setTimeout(() => (btn.textContent = "复制"), 1200)
}

export const Markdown = memo(function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  return (
    <div
      className={cn("markdown text-[0.94rem]", streaming && "is-streaming", className)}
      onClick={onClick as any}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  )
})
