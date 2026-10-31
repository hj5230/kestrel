// The iPhone gesture for a side drawer: a swipe in from the left edge opens it, a swipe to the left closes it.
// Only a mostly horizontal swipe counts, so vertical scrolling that starts near the edge is left alone.
import { useEffect } from "preact/hooks"

const EDGE = 24
const DISTANCE = 48

export function useEdgeSwipe(enabled: boolean, open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number; opening: boolean } | null = null
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0]
      start = e.touches.length === 1 && (open || p.clientX <= EDGE) ? { x: p.clientX, y: p.clientY, opening: !open } : null
    }
    const onMove = (e: TouchEvent) => {
      if (!start) return
      const p = e.touches[0]
      const dx = p.clientX - start.x
      const dy = Math.abs(p.clientY - start.y)
      if (dy > Math.abs(dx) && dy > 12) {
        start = null
        return
      }
      if (start.opening ? dx > DISTANCE : dx < -DISTANCE) {
        if (dy < Math.abs(dx) * 0.6) setOpen(start.opening)
        start = null
      }
    }
    const onEnd = () => (start = null)
    window.addEventListener("touchstart", onStart, { capture: true, passive: true })
    window.addEventListener("touchmove", onMove, { capture: true, passive: true })
    window.addEventListener("touchend", onEnd, { capture: true, passive: true })
    window.addEventListener("touchcancel", onEnd, { capture: true, passive: true })
    return () => {
      window.removeEventListener("touchstart", onStart, { capture: true })
      window.removeEventListener("touchmove", onMove, { capture: true })
      window.removeEventListener("touchend", onEnd, { capture: true })
      window.removeEventListener("touchcancel", onEnd, { capture: true })
    }
  }, [enabled, open, setOpen])
}
