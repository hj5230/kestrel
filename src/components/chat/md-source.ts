// Markdown source highlighting for the composer. The result sits under a transparent textarea, so every
// style here must keep glyph advance widths and line breaks unchanged (colors, backgrounds, shadows) or the
// caret drifts away from the text it belongs to.

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`

const INLINE = /(`+)([^`]*?)\1|(\*\*|__)(?=\S)(.*?\S)\3|(\*|_)(?=[^\s*_])([^*_]*?[^\s*_])\5|\[([^\]]+)\]\(([^)\s]+)\)/g
/** An opening or closing code fence, as CommonMark reads it (up to three spaces of indent). */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/

function inline(line: string): string {
  let out = ""
  let last = 0
  for (const m of line.matchAll(INLINE)) {
    out += esc(line.slice(last, m.index))
    if (m[1]) out += span("md-mark", m[1]) + span("md-code", m[2]) + span("md-mark", m[1])
    else if (m[3]) out += span("md-mark", m[3]) + `<span class="md-strong">${inline(m[4])}</span>` + span("md-mark", m[3])
    else if (m[5]) out += span("md-mark", m[5]) + `<span class="md-em">${inline(m[6])}</span>` + span("md-mark", m[5])
    else out += span("md-mark", "[") + span("md-link", m[7]) + span("md-mark", `](${m[8]})`)
    last = m.index! + m[0].length
  }
  return out + esc(line.slice(last))
}

function line(src: string): string {
  const h = /^(#{1,6})(\s.*)?$/.exec(src)
  if (h) return span("md-mark", h[1]) + `<span class="md-heading">${inline(h[2] ?? "")}</span>`
  const q = /^(\s*(?:>\s?)+)(.*)$/.exec(src)
  if (q) return span("md-mark", q[1]) + inline(q[2])
  const li = /^(\s*)([-*+]|\d+[.)])(\s.*)$/.exec(src)
  if (li) return esc(li[1]) + span("md-mark", li[2]) + inline(li[3])
  return inline(src)
}

/** Lines in order, with each fenced block (fences included) gathered into one group. */
export function fenceGroups(lines: string[]): { block: boolean; lines: string[] }[] {
  const groups: { block: boolean; lines: string[] }[] = []
  let fence: string | null = null
  for (const l of lines) {
    const f = FENCE.exec(l)
    if (fence) {
      groups[groups.length - 1].lines.push(l)
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !l.slice(f[0].length).trim()) fence = null
    } else if (f) {
      fence = f[1]
      groups.push({ block: true, lines: [l] })
    } else {
      groups.push({ block: false, lines: [l] })
    }
  }
  return groups
}

export function highlightMarkdownSource(src: string): string {
  const groups = fenceGroups(src.split("\n"))
  // A trailing newline needs a glyph after it, or the mirror ends one line short of the textarea.
  const END = "​"
  let out = ""
  groups.forEach((g, i) => {
    const last = i === groups.length - 1
    if (!g.block) {
      out += line(g.lines[0]) + (last ? END : "\n")
      return
    }
    // A fenced block is one box. Its trailing newline goes inside the box: a newline right after a block
    // element would start an extra, empty line that the textarea doesn't have.
    const body = g.lines.map((l, j) => span(j === 0 || (j === g.lines.length - 1 && FENCE.test(l) && g.lines.length > 1) ? "md-mark" : "md-codeline", l)).join("\n")
    out += `<span class="md-codeblock">${body}${last ? END : "\n"}</span>`
  })
  return out
}
