// Mobile: keep the app exactly on the visible area. When the keyboard opens iOS shrinks the *visual*
// viewport and pans it down the page to reveal the field. Scrolling the page back afterwards made the
// whole app jump up and then return; instead the app is fixed to the visual viewport's top and height,
// so it follows the pan in the same frame and nothing on screen moves except the keyboard.
export function trackVisualViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const sync = () => {
    const keyboard = Math.max(0, window.innerHeight - vv.height)
    root.style.setProperty("--app-height", `${Math.round(vv.height)}px`)
    root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`)
    // Bottom sheets sit on top of the keyboard rather than behind it.
    root.style.setProperty("--kb", `${Math.round(keyboard)}px`)
    root.classList.toggle("keyboard-open", keyboard > 120)
  }
  vv.addEventListener("resize", sync)
  vv.addEventListener("scroll", sync)
  sync()
}
