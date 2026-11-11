// The composer's Markdown source model: which lines are code, and the highlighted copy drawn under the
// transparent textarea. That copy must lay out exactly like the textarea:
// - one block per source line (an empty line holds a <br>), in the textarea's font, width and wrapping;
// - only styles that keep glyph widths and line heights: colors, backgrounds, text strokes, inset shadows;
// - block decorations (a code block's frame, a quote's bar) drawn on those line blocks, never taking space.
// Its text content is the source, line for line; source.test.ts holds that for every case it knows.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const span = (cls: string, s: string) => (s ? `<span class="${cls}">${esc(s)}</span>` : "")

/** An opening or closing code fence, as CommonMark reads it (up to three spaces of indent). */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/

export type Role = "text" | "open" | "body" | "close"
export interface Line {
  text: string
  role: Role
  /** The last line of a code block, closed or not. */
  end?: boolean
  /** For an opening fence: whether a closing fence follows. */
  closed?: boolean
}

/** Every line with its place in or out of a fenced code block. */
export function lineRoles(lines: string[]): Line[] {
  const out: Line[] = []
  let fence: string | null = null
  let opened = -1
  for (const text of lines) {
    const f = FENCE.exec(text)
    // A backtick fence's info string can't contain a backtick: "```a```" on one line is inline code.
    const isFence = !!f && !(f[1][0] === "`" && text.slice(f[0].length).includes("`"))
    if (fence) {
      const closes = isFence && f![1][0] === fence[0] && f![1].length >= fence.length && !text.slice(f![0].length).trim()
      out.push({ text, role: closes ? "close" : "body" })
      if (closes) {
        out[opened].closed = true
        fence = null
      }
    } else if (isFence) {
      fence = f![1]
      opened = out.length
      out.push({ text, role: "open", closed: false })
    } else out.push({ text, role: "text" })
  }
  out.forEach((l, i) => {
    if (l.role !== "text" && (i === out.length - 1 || out[i + 1].role === "text" || out[i + 1].role === "open")) l.end = true
  })
  return out
}

const INLINE = new RegExp(
  [
    String.raw`\\(?<esc>[!-/:-@\[-\x60{-~])`,
    String.raw`(?<ticks>\x60+)(?<code>[^\x60]+?|\x60+?)\k<ticks>(?!\x60)`,
    String.raw`\*\*(?=\S)(?<bs>.*?\S)\*\*`,
    String.raw`(?<![\p{L}\p{N}_])__(?=\S)(?<bu>.*?\S)__(?![\p{L}\p{N}_])`,
    String.raw`\*(?=[^\s*])(?<is>[^*]*?[^\s*])\*`,
    String.raw`(?<![\p{L}\p{N}_])_(?=[^\s_])(?<iu>[^_]*?[^\s_])_(?![\p{L}\p{N}_])`,
    String.raw`~~(?=\S)(?<del>.*?\S)~~`,
    String.raw`\[(?<label>[^\]]+)\]\((?<href>[^)\s]+)\)`,
    String.raw`(?<url>https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])`,
  ].join("|"),
  "gu",
)

export function inline(src: string): string {
  let out = ""
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    const g = m.groups!
    out += esc(src.slice(last, m.index))
    if (g.esc !== undefined) out += span("md-mark", "\\") + esc(g.esc)
    else if (g.ticks) out += span("md-mark", g.ticks) + span("md-code", g.code) + span("md-mark", g.ticks)
    else if (g.bs !== undefined || g.bu !== undefined) {
      const d = g.bs !== undefined ? "**" : "__"
      out += span("md-mark", d) + `<span class="md-strong">${inline(g.bs ?? g.bu)}</span>` + span("md-mark", d)
    } else if (g.is !== undefined || g.iu !== undefined) {
      const d = g.is !== undefined ? "*" : "_"
      out += span("md-mark", d) + `<span class="md-em">${inline(g.is ?? g.iu)}</span>` + span("md-mark", d)
    } else if (g.del !== undefined) out += span("md-mark", "~~") + `<span class="md-del">${inline(g.del)}</span>` + span("md-mark", "~~")
    else if (g.label !== undefined) out += span("md-mark", "[") + span("md-link", g.label) + span("md-mark", `](${g.href})`)
    else out += span("md-link", g.url)
    last = m.index! + m[0].length
  }
  return out + esc(src.slice(last))
}

/** List item: indent, marker, the space after it, and a task box. Shared with the Return rules. */
export const LIST = /^(\s*)([-*+]|(\d{1,9})([.)]))(\s+|$)(\[[ xX]\](?:\s+|$))?/
export const QUOTE = /^ {0,3}(?:> ?)+/
const HEADING = /^( {0,3}#{1,6})(\s.*)?$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function textLine(src: string): { cls: string; html: string } {
  const h = HEADING.exec(src)
  if (h) return { cls: "md-h", html: span("md-mark", h[1]) + inline(h[2] ?? "") }
  if (RULE.test(src)) return { cls: "md-rule", html: span("md-mark", src) }
  const q = QUOTE.exec(src)
  if (q) return { cls: "md-quote", html: span("md-mark", q[0]) + textLine(src.slice(q[0].length)).html }
  const li = LIST.exec(src)
  if (li) {
    const task = li[6] ? span(/x/i.test(li[6]) ? "md-mark md-done" : "md-mark", li[6]) : ""
    return { cls: "", html: esc(li[1]) + span("md-mark", li[2]) + esc(li[5]) + task + inline(src.slice(li[0].length)) }
  }
  if (/^\s*\|/.test(src)) {
    if (TABLE_DELIMITER.test(src)) return { cls: "md-table", html: span("md-mark", src) }
    // Cells split on pipes that aren't escaped; the pipes are dimmed and the cells highlighted.
    return { cls: "md-table", html: src.split(/(?<!\\)(\|)/).map((part) => (part === "|" ? span("md-mark", "|") : inline(part))).join("") }
  }
  return { cls: "", html: inline(src) }
}

function renderLine(l: Line): string {
  let cls = "md-line"
  let html: string
  if (l.role === "text") {
    const r = textLine(l.text)
    if (r.cls) cls += ` ${r.cls}`
    html = r.html
  } else {
    cls += " md-codeline"
    if (l.role === "open") {
      const f = FENCE.exec(l.text)!
      html = span("md-mark", f[0]) + span("md-info", l.text.slice(f[0].length))
    } else html = l.role === "close" ? span("md-mark", l.text) : esc(l.text)
  }
  return `<div class="${cls}">${html || "<br>"}</div>`
}

/** A code block's lines go in one box with no box model of its own, which paints the frame once. */
export function highlightMarkdownSource(src: string): string {
  let out = ""
  for (const l of lineRoles(src.split("\n"))) {
    if (l.role === "open") out += '<div class="md-codeblock">'
    out += renderLine(l)
    if (l.end) out += "</div>"
  }
  return out
}
