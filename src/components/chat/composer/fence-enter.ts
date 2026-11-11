// Return inside Markdown code fences. Typing ``` (with an optional language) and pressing Return opens a
// block with its closing fence already there; inside a block Return is a newline, never "send".
import { FENCE, fenceGroups } from "../md-source"

export interface Edit {
  /** Text replacing the selection. */
  insert: string
  /** Where the caret goes, counted from the start of the insertion. */
  caret: number
  /** The whole text afterwards, for when the browser can't insert natively. */
  text: string
}

/** The edit Return should make at the caret, or null when Return keeps its usual meaning. */
export function fenceEnter(text: string, start: number, end: number): Edit | null {
  if (start !== end) return null
  const lines = text.split("\n")
  const index = text.slice(0, start).split("\n").length - 1
  const lineEnd = start + (lines[index].length - (start - (text.lastIndexOf("\n", start - 1) + 1)))
  const insert = (s: string, caret: number): Edit => ({ insert: s, caret, text: text.slice(0, start) + s + text.slice(end) })
  let row = 0
  for (const g of fenceGroups(lines)) {
    const at = index - row
    row += g.lines.length
    if (at >= g.lines.length) continue
    if (!g.block) return null
    const last = g.lines.length - 1
    const closed = last > 0 && FENCE.test(g.lines[last])
    // On the closing fence Return means what it always does.
    if (closed && at === last) return null
    if (at === 0 && !closed && start === lineEnd) return insert(`\n\n${FENCE.exec(g.lines[0])![0].trimStart()}`, 1)
    return insert("\n", 1)
  }
  return null
}
