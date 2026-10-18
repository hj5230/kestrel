// Mobile: size the app to what is actually visible. iOS shrinks the *visual* viewport when the
// keyboard opens but keeps the layout viewport, scrolling the whole page up instead — which would
// push the header off screen. Pin the page and shrink the app to the visible area.
export function trackVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const sync = () => {
    const keyboard = Math.max(0, window.innerHeight - vv.height)
    root.style.setProperty("--app-height", `${Math.round(vv.height)}px`)
    // Bottom sheets sit on top of the keyboard rather than behind it.
    root.style.setProperty("--kb", `${Math.round(keyboard)}px`)
    root.classList.toggle("keyboard-open", keyboard > 120)
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
  }
  vv.addEventListener("resize", sync)
  vv.addEventListener("scroll", sync)
  sync()
}
