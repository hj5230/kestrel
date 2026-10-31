// Mobile: the app fills the screen above the keyboard and the page itself never moves. iOS would scroll the
// web view to reveal a focused field, which made the whole app jump up and back; the native side
// (src-tauri/src/keyboard.rs) pins that scroll and reports the keyboard as it starts to move. --kb takes its
// height and is transitioned over the same duration (index.css), so the app's bottom edge, and the composer
// on it, rides up with the keyboard while everything above stays where it is.
export function trackVisualViewport() {
  const root = document.documentElement
  const set = (height: number, duration: number) => {
    root.style.setProperty("--kb-duration", `${Math.max(0, duration)}s`)
    root.style.setProperty("--kb", `${Math.round(height)}px`)
    root.classList.toggle("keyboard-open", height > 120)
  }
  set(0, 0)
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<{ height: number; duration: number }>("kestrel://keyboard", (e) => set(e.payload.height, e.payload.duration)))
    .catch(() => {})
}
