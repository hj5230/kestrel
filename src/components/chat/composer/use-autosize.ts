// Grows the input with its text up to a cap, keeping the highlighted mirror under it scrolled the same way.
import { useEffect, useLayoutEffect } from "preact/hooks"
import type { RefObject } from "preact"

const MAX_HEIGHT = 320

export function useAutosize(ta: RefObject<HTMLTextAreaElement | null>, mirror: RefObject<HTMLDivElement | null>, text: string) {
  const fit = () => {
    const el = ta.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
    // Sub-pixel line heights make a one-line box a fraction taller than its content; only scroll once the cap is hit.
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
    if (mirror.current) mirror.current.scrollTop = el.scrollTop
  }
  useLayoutEffect(fit, [text])
  // The height depends on the width too: measured while the window or sidebar was resizing, it stays stale.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
}
