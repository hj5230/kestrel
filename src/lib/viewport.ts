// Mobile: the app fills the screen above the keyboard and the page itself never moves. WKWebView is taken
// off the keyboard notifications natively (src-tauri/src/keyboard.rs), so it neither scrolls the page nor
// reveals the focused field; the native side reports the keyboard instead, as it starts to move. --kb takes
// its height and is transitioned over the same duration (index.css), so the app's bottom edge, and the
// composer on it, rides up with the keyboard while everything above stays where it is. A field the keyboard
// would cover elsewhere (low in Settings) is scrolled into view inside its own scroll container.
const editable = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.matches("input, textarea, select") || el.isContentEditable)

export function trackVisualViewport() {
  const root = document.documentElement
  let open = false
  let reveal: ReturnType<typeof setTimeout> | undefined
  const revealFocused = () => {
    const el = document.activeElement
    if (open && editable(el)) el.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  const set = (height: number, duration: number) => {
    root.style.setProperty("--kb-duration", `${Math.max(0, duration)}s`)
    root.style.setProperty("--kb", `${Math.round(height)}px`)
    open = height > 120
    root.classList.toggle("keyboard-open", open)
    clearTimeout(reveal)
    // Once the app has finished shrinking, so the field is measured against what is left above the keyboard.
    if (open) reveal = setTimeout(revealFocused, Math.max(0, duration) * 1000 + 30)
  }
  set(0, 0)
  // Moving to another field while the keyboard stays up sends no keyboard notification.
  document.addEventListener("focusin", () => requestAnimationFrame(revealFocused))
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<{ height: number; duration: number }>("kestrel://keyboard", (e) => set(e.payload.height, e.payload.duration)))
    .catch(() => {})
}
