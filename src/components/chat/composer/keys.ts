// Keyboard handling for the input, in the order it applies: the completion menu, Esc to stop, ↑/↓ through
// earlier messages, and the send key. Composition (IME) keystrokes are never taken.
import { isTouch } from "@/lib/platform"
import type { MenuItem } from "./completions"
import { fenceEnter, type Edit } from "./fence-enter"

export interface KeyContext {
  menu: { open: boolean; items: MenuItem[]; index: number; setIndex: (f: (i: number) => number) => void; pick: (item: MenuItem) => void; dismiss: () => void }
  running?: boolean
  onAbort?: () => void
  history: string[]
  historyIndex: number
  setHistoryIndex: (i: number) => void
  text: string
  setText: (text: string) => void
  /** The caret is at the very start, where ↑ means "previous message" rather than "line up". */
  atStart: boolean
  sendKey: "enter" | "mod-enter"
  submit: () => void
  /** The textarea's selection, for edits Return makes itself. */
  selection: [number, number]
  edit: (e: Edit) => void
}

export function handleComposerKey(e: KeyboardEvent, c: KeyContext) {
  if (e.isComposing || e.keyCode === 229) return
  const take = (fn: () => void) => {
    e.preventDefault()
    fn()
  }
  const { menu } = c
  if (menu.open) {
    const n = menu.items.length
    if (e.key === "ArrowDown") return take(() => menu.setIndex((i) => (i + 1) % n))
    if (e.key === "ArrowUp") return take(() => menu.setIndex((i) => (i - 1 + n) % n))
    if (e.key === "Enter" || e.key === "Tab") return take(() => menu.pick(menu.items[menu.index]))
    if (e.key === "Escape") return take(menu.dismiss)
  }
  if (e.key === "Escape" && c.running && c.onAbort) return take(c.onAbort)
  if (e.key === "ArrowUp" && c.history.length && (c.text === "" || c.historyIndex >= 0) && c.atStart) {
    return take(() => {
      const next = Math.min(c.historyIndex + 1, c.history.length - 1)
      c.setHistoryIndex(next)
      c.setText(c.history[c.history.length - 1 - next])
    })
  }
  if (e.key === "ArrowDown" && c.historyIndex >= 0) {
    return take(() => {
      const next = c.historyIndex - 1
      c.setHistoryIndex(next)
      c.setText(next >= 0 ? c.history[c.history.length - 1 - next] : "")
    })
  }
  const mod = e.metaKey || e.ctrlKey
  // Code fences: Return opens a block or adds a line inside one. ⌘/Ctrl+Return still sends.
  if (e.key === "Enter" && !mod && !e.altKey) {
    const edit = fenceEnter(c.text, ...c.selection)
    if (edit) return take(() => c.edit(edit))
  }
  // A software keyboard's return key inserts a newline; sending is the button's job.
  if (e.key === "Enter" && !isTouch) {
    if (c.sendKey === "enter" ? !e.shiftKey || mod : mod) take(c.submit)
  }
}
