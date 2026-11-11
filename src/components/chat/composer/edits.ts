// The edits the composer makes on its own keys: a newline continues a list, a quote or a code block's
// indent, and Tab indents list items and code. They are pure functions of the text and the selection, so
// they are tested (edits.test.ts) and applied through the textarea's own editing, which keeps undo working.
// Each returns null when the key should do what it always does.
import { FENCE, LIST, QUOTE, lineRoles } from "./source"

export interface Edit {
  from: number
  to: number
  insert: string
  /** The selection afterwards. */
  sel: [number, number]
}

function locate(text: string, pos: number) {
  const lines = text.split("\n")
  const before = text.slice(0, pos).split("\n")
  const index = before.length - 1
  const col = before[index].length
  return { lines, index, col, start: pos - col }
}

const put = (from: number, to: number, insert: string, caret = from + insert.length): Edit => ({ from, to, insert, sel: [caret, caret] })

/** The caret is inside a code block (its opening fence included), where Return is a newline, not "send". */
export function inCode(text: string, pos: number): boolean {
  const { lines, index } = locate(text, pos)
  const role = lineRoles(lines)[index].role
  return role === "open" || role === "body"
}

/** The marker a line starts with (quote, then list item) and the one a new line after it should get. */
function continuation(src: string): { marker: string; next: string; empty: string } | null {
  const q = QUOTE.exec(src)?.[0] ?? ""
  const li = LIST.exec(src.slice(q.length))
  if (!li) return q ? { marker: q, next: q, empty: "" } : null
  const bullet = li[3] ? `${Number(li[3]) + 1}${li[4]}` : li[2]
  const next = `${q}${li[1]}${bullet}${li[5] || " "}${li[6] ? "[ ] " : ""}`
  // Return on an empty item ends the list; inside a quote, the quote goes on.
  return { marker: q + li[0], next, empty: q }
}

/** A newline at the caret: Return on a phone, Shift+Return, or Return in code. */
export function newline(text: string, selStart: number, selEnd: number): Edit | null {
  if (selStart !== selEnd) return null
  const { lines, index, col, start } = locate(text, selStart)
  const line = lineRoles(lines)[index]
  const src = lines[index]
  if (line.role === "open") {
    // Right after an opening fence with nothing closing it: the block opens with its closing fence below.
    if (line.closed || col !== src.length) return null
    return put(selStart, selStart, `\n\n${FENCE.exec(src)![0].trimStart()}`, selStart + 1)
  }
  if (line.role === "body") {
    const indent = /^[ \t]*/.exec(src)![0].slice(0, col)
    return indent ? put(selStart, selStart, `\n${indent}`) : null
  }
  if (line.role === "close") return null
  const c = continuation(src)
  if (!c || col < c.marker.length) return null
  if (!src.slice(c.marker.length).trim()) return put(start, start + src.length, c.empty)
  return put(selStart, selStart, `\n${c.next}`)
}

const lead = (s: string) => /^ */.exec(s)![0].length

/** How far a list line should move to nest under, or come out from, the items above it. */
function listShift(lines: string[], index: number, outdent: boolean): number {
  const w = lead(lines[index])
  for (let j = index - 1; j >= 0; j--) {
    const li = LIST.exec(lines[j])
    if (!li) {
      if (lines[j].trim()) break
      continue
    }
    const indent = li[1].length
    if (outdent && indent < w) return indent - w
    if (!outdent && indent <= w) {
      const content = indent + li[2].length + (li[5].length || 1)
      return content > w ? content - w : 2
    }
  }
  return outdent ? -Math.min(w, 2) : 2
}

/** Tab (or Shift+Tab) on list items or code lines: indent or outdent every line the selection touches. */
export function indent(text: string, selStart: number, selEnd: number, outdent: boolean): Edit | null {
  const { lines, index: first, start } = locate(text, selStart)
  const end = locate(text, selEnd)
  // A selection ending at the very start of a line doesn't take that line along.
  const last = selEnd > selStart && end.col === 0 ? end.index - 1 : end.index
  const roles = lineRoles(lines)
  const touched = lines.slice(first, last + 1)
  const code = roles.slice(first, last + 1).every((r) => r.role === "body")
  const list = touched.every((l, i) => LIST.test(l) || (i > 0 && !l.trim()))
  if (!code && !list) return null
  const shift = code ? (outdent ? -Math.min(...touched.map((l) => Math.min(lead(l), 2))) : 2) : listShift(lines, first, outdent)
  if (!shift) return null
  // Blank lines inside a multi-line selection stay blank; a lone caret line always moves.
  const keep = (l: string) => touched.length > 1 && !l.trim()
  const moved = touched.map((l) => (keep(l) ? l : shift > 0 ? " ".repeat(shift) + l : l.slice(Math.min(-shift, lead(l)))))
  const insert = moved.join("\n")
  const to = start + touched.join("\n").length
  const firstDelta = moved[0].length - touched[0].length
  // A selection from the start of a line keeps the whole line, its new indent included.
  const a = selStart !== selEnd && selStart === start ? start : Math.max(start, selStart + firstDelta)
  const b = selEnd + (insert.length - (to - start))
  return { from: start, to, insert, sel: selStart === selEnd ? [a, a] : [a, Math.max(a, b)] }
}
