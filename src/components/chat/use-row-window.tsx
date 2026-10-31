// Mounts only the latest rows of a long transcript and more as the reader nears the top, keeping their place.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"

/** Rows mounted at first, and how many more each time the reader nears the top. Long sessions used to mount
 *  every message (and highlight every code block) before showing anything. */
export const WINDOW = 40

/** Mounts the last `limit` rows; a sentinel above them grows the window, keeping the reader's place. */
export function useRowWindow(total: number) {
  const [limit, setLimit] = useState(WINDOW)
  const sentinel = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ el: HTMLElement; height: number; top: number } | null>(null)
  const hidden = Math.max(0, total - limit)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hidden) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        const scroller = el.closest("[data-transcript-scroll]") as HTMLElement | null
        if (scroller) anchor.current = { el: scroller, height: scroller.scrollHeight, top: scroller.scrollTop }
        setLimit((n) => n + WINDOW)
      },
      { rootMargin: "800px 0px 0px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hidden > 0, limit])
  // Rows were added above the reader: move down by exactly what was added, so nothing on screen shifts.
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a) return
    anchor.current = null
    a.el.scrollTop = a.top + (a.el.scrollHeight - a.height)
  }, [limit])
  return { start: hidden, sentinel: hidden ? <div ref={sentinel} className="h-px" aria-hidden="true" /> : null }
}
