// Edge drags move the actual Radix drawer, not a screenshot. Keep the gesture alive across its mount;
// Radix retains focus/scroll locking, and only release commits the final open state.
import { useEffect, useRef } from "preact/hooks"

export function useEdgeSwipe(enabled: boolean, open: boolean, setOpen: (open: boolean) => void) {
  const state = useRef({ open, setOpen })
  state.current = { open, setOpen }
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    let drag: { x: number; y: number; initial: boolean; locked: boolean; dx: number; lastX: number; at: number; velocity: number } | null = null
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const panel = () => document.querySelector<HTMLElement>('[data-sidebar="sidebar"][data-mobile="true"]')
    const clear = () => {
      cancelAnimationFrame(frame)
      root.removeAttribute("data-sidebar-drag")
      root.style.removeProperty("--sidebar-drag-x")
      root.style.removeProperty("--sidebar-drag-opacity")
    }
    const paint = () => {
      if (!drag?.locked) return
      const width = panel()?.getBoundingClientRect().width ?? 288
      const x = Math.min(0, Math.max(-width, (drag.initial ? 0 : -width) + drag.dx))
      root.style.setProperty("--sidebar-drag-x", `${x}px`)
      root.style.setProperty("--sidebar-drag-opacity", String(1 + x / width))
      frame = requestAnimationFrame(paint)
    }
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || root.hasAttribute("data-sidebar-drag")) return
      const p = e.touches[0]
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], [data-no-edge-swipe]')) return
      if (!state.current.open && (p.clientX > 24 || document.querySelector('[role="dialog"][data-state="open"], [role="menu"]'))) return
      if (state.current.open && !target.closest('[data-sidebar="sidebar"], [data-slot="sheet-overlay"]')) return
      drag = { x: p.clientX, y: p.clientY, initial: state.current.open, locked: false, dx: 0, lastX: p.clientX, at: e.timeStamp, velocity: 0 }
    }
    const move = (e: TouchEvent) => {
      if (!drag) return
      if (e.touches.length !== 1) return end(true)
      const p = e.touches[0]
      const dx = p.clientX - drag.x
      const dy = Math.abs(p.clientY - drag.y)
      if (!drag.locked) {
        if (dy > Math.abs(dx) && dy > 8) { drag = null; return }
        if (Math.abs(dx) < 8 || (!drag.initial && dx < 0)) return
        drag.locked = true
        root.dataset.sidebarDrag = "tracking"
        root.style.setProperty("--sidebar-drag-x", drag.initial ? "0px" : "-100%")
        root.style.setProperty("--sidebar-drag-opacity", drag.initial ? "1" : "0")
        state.current.setOpen(true)
        frame = requestAnimationFrame(paint)
      }
      drag.velocity = (p.clientX - drag.lastX) / Math.max(1, e.timeStamp - drag.at)
      drag.lastX = p.clientX
      drag.at = e.timeStamp
      drag.dx = dx
      e.preventDefault()
    }
    const end = (cancelled: boolean) => {
      if (!drag) return
      const d = drag
      drag = null
      cancelAnimationFrame(frame)
      if (!d.locked) return
      const width = panel()?.getBoundingClientRect().width ?? 288
      const progress = Math.max(0, Math.min(1, (d.initial ? 1 : 0) + d.dx / width))
      const next = cancelled ? d.initial : Math.abs(d.velocity) > 0.45 ? d.velocity > 0 : progress > 0.5
      root.dataset.sidebarDrag = "settling"
      root.style.setProperty("--sidebar-drag-x", next ? "0px" : `${-width}px`)
      root.style.setProperty("--sidebar-drag-opacity", next ? "1" : "0")
      timer = setTimeout(() => { state.current.setOpen(next); clear() }, 180)
    }
    const finish = () => end(false)
    const cancel = () => end(true)
    // A drag must not also activate the row below the finger when it ends.
    const click = (e: MouseEvent) => { if (root.hasAttribute("data-sidebar-drag")) { e.preventDefault(); e.stopPropagation() } }
    window.addEventListener("touchstart", start, { capture: true, passive: true })
    window.addEventListener("touchmove", move, { capture: true, passive: false })
    window.addEventListener("touchend", finish, true)
    window.addEventListener("touchcancel", cancel, true)
    window.addEventListener("resize", cancel)
    window.addEventListener("click", click, true)
    return () => {
      if (timer) clearTimeout(timer)
      clear()
      window.removeEventListener("touchstart", start, true)
      window.removeEventListener("touchmove", move, true)
      window.removeEventListener("touchend", finish, true)
      window.removeEventListener("touchcancel", cancel, true)
      window.removeEventListener("resize", cancel)
      window.removeEventListener("click", click, true)
    }
  }, [enabled])
}
