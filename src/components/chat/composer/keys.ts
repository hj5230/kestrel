// What each key does in the input, decided in one place and in this order:
// 1. composition (IME) keystrokes are never taken;
// 2. the completion menu, while open, takes ↑ ↓ Return Tab Esc;
// 3. Esc stops a running turn;
// 4. ↑ at the very start of an empty (or recalled) input walks back through earlier messages, ↓ forward;
// 5. Tab and Shift+Tab indent list items and code lines; elsewhere Tab moves focus as usual;
// 6. Return either sends or makes a newline. ⌘/Ctrl+Return always sends. A newline is what Return means
//    on a touch keyboard, with Shift (or without, when the send key is ⌘Return), and inside a code block.
//    A newline continues a list or quote, keeps a code line's indent and opens a block after a fence.
// The edits themselves are in edits.ts; `apply` makes them through the textarea so undo keeps working.
import { isTouch } from "@/lib/platform"
import type { MenuItem } from "./completions"
import { inCode, indent, newline, type Edit } from "./edits"

export interface KeyContext {
  menu: { open: boolean; items: MenuItem[]; index: number; setIndex: (f: (i: number) => number) => void; pick: (item: MenuItem) => void; dismiss: () => void }
  running?: boolean
  onAbort?: () => void
  history: string[]
  historyIndex: number
  setHistoryIndex: (i: number) => void
  text: string
  setText: (text: string) => void
  sendKey: "enter" | "mod-enter"
  submit: () => void
  /** The textarea's selection. */
  selection: [number, number]
  apply: (e: Edit) => void
}

export function handleComposerKey(e: KeyboardEvent, c: KeyContext) {
  if (e.isComposing || e.keyCode === 229) return
  const take = (fn: () => void) => {
    e.preventDefault()
    fn()
  }
  const [start, end] = c.selection
  const { menu } = c
  if (menu.open) {
    const n = menu.items.length
    if (e.key === "ArrowDown") return take(() => menu.setIndex((i) => (i + 1) % n))
    if (e.key === "ArrowUp") return take(() => menu.setIndex((i) => (i - 1 + n) % n))
    if (e.key === "Enter" || e.key === "Tab") return take(() => menu.pick(menu.items[menu.index]))
    if (e.key === "Escape") return take(menu.dismiss)
  }
  if (e.key === "Escape" && c.running && c.onAbort) return take(c.onAbort)
  if (e.key === "ArrowUp" && c.history.length && (c.text === "" || c.historyIndex >= 0) && start === 0 && end === 0) {
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
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const edit = indent(c.text, start, end, e.shiftKey)
    if (edit) return take(() => c.apply(edit))
    return
  }
  if (e.key !== "Enter" || e.altKey) return
  const mod = e.metaKey || e.ctrlKey
  if (mod && !isTouch) return take(c.submit)
  const wantsNewline = isTouch || e.shiftKey || c.sendKey === "mod-enter" || inCode(c.text, start)
  if (!wantsNewline) return take(c.submit)
  const edit = newline(c.text, start, end)
  if (edit) take(() => c.apply(edit))
}
