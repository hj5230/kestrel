// Reveal only the new tail of rendered text with the greeting's motion. Wrappers live outside Preact's
// child tree and are removed after animation, keeping old text, selection and Markdown semantics intact.
import { useLayoutEffect, useRef } from "preact/hooks"

export function useTextReveal(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef("")
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const text = root.textContent ?? ""
    const before = previous.current
    previous.current = text
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let common = 0
    while (common < before.length && common < text.length && before[common] === text[common]) common++
    if (common === text.length) return
    // Keep work bounded even when the server delivers a very large chunk. Whole words preserve wrapping.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    let offset = 0
    let index = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const node of nodes) {
      const start = Math.max(0, common - offset)
      offset += node.length
      if (start >= node.length || node.parentElement?.closest("pre, code, button, .reveal-tail")) continue
      const tail = start ? node.splitText(start) : node
      const fragment = document.createDocumentFragment()
      const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(tail.data)].map((x) => x.segment)
      // A large chunk gets one tail animation rather than thousands of animated elements.
      const chunks = index + parts.length <= 160 ? parts : [tail.data]
      for (const part of chunks) {
        if (/^\s+$/.test(part)) { fragment.appendChild(document.createTextNode(part)); continue }
        const span = document.createElement("span")
        span.className = "reveal-tail"
        span.style.animationDelay = `${Math.min(index++ * 22, 120)}ms`
        span.textContent = part
        fragment.appendChild(span)
        timers.push(setTimeout(() => span.replaceWith(...span.childNodes), 650))
      }
      tail.replaceWith(fragment)
    }
    return () => {
      timers.forEach(clearTimeout)
      root.querySelectorAll(".reveal-tail").forEach((span) => span.replaceWith(...span.childNodes))
    }
  })
  return ref
}
