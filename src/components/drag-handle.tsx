// A real grab region for mobile sheets and sheet-shaped menus. Radix still owns focus and dismissal;
// native pointer capture moves the panel continuously and Escape commits a completed dismiss gesture.
import { useEffect, useRef } from "preact/hooks"
import { t } from "@/lib/i18n"

export function DragHandle() {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const handle = ref.current
    const panel = handle?.parentElement
    if (!handle || !panel) return
    let drag: { id: number; y: number; last: number; time: number; velocity: number; distance: number } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let suppressClick = false
    const click = (e: MouseEvent) => {
      if (!suppressClick) return
      e.preventDefault()
      e.stopImmediatePropagation()
      suppressClick = false
    }
    const reset = () => {
      panel.style.removeProperty("translate")
      panel.style.removeProperty("transition")
      delete panel.dataset.dragging
    }
    // Re-enabling animations on a panel that is already open would replay its entrance.
    const settle = () => {
      panel.dataset.gestureSettled = ""
      reset()
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return
      if (timer) clearTimeout(timer)
      drag = { id: e.pointerId, y: e.clientY, last: e.clientY, time: e.timeStamp, velocity: 0, distance: 0 }
      handle.setPointerCapture(e.pointerId)
      panel.dataset.dragging = "true"
      panel.style.transition = "none"
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      drag.velocity = (e.clientY - drag.last) / Math.max(1, e.timeStamp - drag.time)
      drag.last = e.clientY
      drag.time = e.timeStamp
      drag.distance = Math.max(0, e.clientY - drag.y)
      panel.style.translate = `0 ${drag.distance}px`
      e.preventDefault()
    }
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      const close = e.type !== "pointercancel" && (drag.distance > panel.offsetHeight * 0.3 || (drag.distance > 20 && drag.velocity > 0.45))
      suppressClick = drag.distance > 3 || e.type === "pointercancel"
      drag = null
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      panel.style.transition = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "translate 180ms ease-out"
      panel.style.translate = close ? `0 ${panel.offsetHeight + 40}px` : "0 0"
      timer = setTimeout(() => {
        if (close) {
          // Stay where the gesture left the panel: with its animation still suppressed, Radix unmounts it at
          // once instead of snapping back and replaying the exit. Reset only if the dismissal was refused.
          panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
          timer = setTimeout(settle, 400)
        } else settle()
      }, 180)
    }
    handle.addEventListener("click", click, true)
    handle.addEventListener("pointerdown", down)
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
    return () => {
      if (timer) clearTimeout(timer)
      handle.removeEventListener("click", click, true)
      handle.removeEventListener("pointerdown", down)
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
      reset()
    }
  }, [])
  return <button ref={ref} type="button" data-sheet-grabber aria-label={t("common.close")} onClick={(e) => e.currentTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))}><span /></button>
}
