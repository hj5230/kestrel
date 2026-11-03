// Plain streamed text uses the same sanitized, DOM-owned reveal surface as Markdown.
import { useTextReveal } from "@/hooks/use-text-reveal"

export function RevealedText({ text, streaming, className }: { text: string; streaming: boolean; className?: string }) {
  const ref = useTextReveal(streaming)
  const html = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
