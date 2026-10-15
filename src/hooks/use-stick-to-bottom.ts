import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"

const BOTTOM_SLACK = 8

export function useStickToBottom(deps: unknown[]) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const expectedTop = useRef<number | null>(null)
  const jumping = useRef(false)
  const [detached, setDetached] = useState(false)

  const setStick = (v: boolean) => {
    stick.current = v
    setDetached(!v)
  }

  const scrollToEnd = (el: HTMLDivElement | null) => {
    if (!el) return
    el.scrollTop = el.scrollHeight
    expectedTop.current = el.scrollTop
  }

  useEffect(() => {
    const el = node
    if (!el) return
    const onScroll = () => {
      const top = el.scrollTop
      if (expectedTop.current !== null && Math.abs(top - expectedTop.current) < 2) return
      expectedTop.current = null
      const distance = el.scrollHeight - top - el.clientHeight
      if (jumping.current) {
        if (distance <= BOTTOM_SLACK) jumping.current = false
        return
      }
      if (distance <= BOTTOM_SLACK) {
        if (!stick.current) setStick(true)
      } else if (stick.current) {
        setStick(false)
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        jumping.current = false
        if (stick.current) setStick(false)
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
    }
  }, [node])

  useLayoutEffect(() => {
    if (stick.current) scrollToEnd(node)
  }, [node, ...deps])

  const jump = useCallback(() => {
    setStick(true)
    if (!node) return
    expectedTop.current = null
    jumping.current = true
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" })
  }, [node])

  const follow = useCallback(() => {
    setStick(true)
    requestAnimationFrame(() => scrollToEnd(node))
  }, [node])

  return { ref: setNode, detached, jump, follow }
}
