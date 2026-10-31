// Mobile: the app fills the screen above the keyboard and the page itself never moves. WKWebView is taken
// off the keyboard notifications natively (src-tauri/src/keyboard.rs), so it neither scrolls the page nor
// reveals the focused field; the native side reports the keyboard instead, as it starts to move.
//
// The layout changes once per keyboard move (--kb, which ends the app at the keyboard), never per frame:
// relaying out a long conversation every frame is what made the keyboard stutter. What rides with the
// keyboard is the dock ([data-keyboard-dock], the composer), moved by a transform the compositor animates
// over the keyboard's own duration. Opening, it slides up first and the layout follows once the keyboard is
// in place; closing, the layout goes first (the keyboard still covers the dock) and it slides down into it.
// A field the keyboard would cover elsewhere (low in Settings) is scrolled into view in its own container.
const editable = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.matches("input, textarea, select") || el.isContentEditable)

// Close to the keyboard's own curve.
const EASING = "cubic-bezier(0.25, 0.8, 0.25, 1)"
const OPEN = 120

export function trackVisualViewport() {
  const root = document.documentElement
  let applied = 0
  let commit: ReturnType<typeof setTimeout> | undefined
  let reveal: ReturnType<typeof setTimeout> | undefined
  let slides: Animation[] = []
  const docks = () => [...document.querySelectorAll<HTMLElement>("[data-keyboard-dock]")]

  const revealFocused = () => {
    const el = document.activeElement
    if (applied > OPEN && editable(el)) el.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  const apply = (height: number) => {
    applied = height
    root.style.setProperty("--kb", `${height}px`)
    root.classList.toggle("keyboard-open", height > OPEN)
  }
  const stop = () => {
    clearTimeout(commit)
    slides.forEach((a) => a.cancel())
    slides = []
  }
  const slide = (el: HTMLElement, from: number, to: number, ms: number) =>
    el.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], { duration: ms, easing: EASING, fill: "forwards" })

  const set = (height: number, duration: number) => {
    height = Math.round(height)
    const ms = Math.max(0, duration) * 1000
    stop()
    clearTimeout(reveal)
    if (height === applied) return
    if (height > applied && ms > 0) {
      // The dock's bottom moves by the change in height and, the first time, sheds the home-indicator inset.
      const shed = applied > OPEN ? 0 : 1
      slides = docks().map((el) => slide(el, 0, applied - height + shed * parseFloat(getComputedStyle(el).paddingBottom), ms))
      commit = setTimeout(() => {
        stop()
        apply(height)
        revealFocused()
      }, ms)
    } else {
      const els = docks()
      const before = els.map((el) => el.getBoundingClientRect().top)
      apply(height)
      if (ms > 0) slides = els.map((el, i) => slide(el, before[i] - el.getBoundingClientRect().top, 0, ms))
      if (height > OPEN) reveal = setTimeout(revealFocused, ms + 30)
    }
  }
  apply(0)
  // Moving to another field while the keyboard stays up sends no keyboard notification.
  document.addEventListener("focusin", () => requestAnimationFrame(revealFocused))
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<{ height: number; duration: number }>("kestrel://keyboard", (e) => set(e.payload.height, e.payload.duration)))
    .catch(() => {})
}
