// Markdown source highlighting for the composer. The result sits under a transparent textarea, so every
// style here must keep glyph advance widths unchanged (colors, backgrounds, text-stroke) or the caret drifts.

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`

const INLINE = /(`+)([^`]*?)\1|(\*\*|__)(?=\S)(.*?\S)\3|(\*|_)(?=[^\s*_])([^*_]*?[^\s*_])\5|\[([^\]]+)\]\(([^)\s]+)\)/g

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

export function highlightMarkdownSource(src: string): string {
  let fence: string | null = null
  const lines = src.split("\n").map((line) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return span(f && !fence ? "md-mark" : "md-codeblock", line)
    }
    if (f) {
      fence = f[1]
      return span("md-mark", line)
    }
    const h = /^(#{1,6})(\s.*)?$/.exec(line)
    if (h) return span("md-mark", h[1]) + `<span class="md-heading">${inline(h[2] ?? "")}</span>`
    const q = /^(\s*(?:>\s?)+)(.*)$/.exec(line)
    if (q) return span("md-mark", q[1]) + inline(q[2])
    const li = /^(\s*)([-*+]|\d+[.)])(\s.*)$/.exec(line)
    if (li) return esc(li[1]) + span("md-mark", li[2]) + inline(li[3])
    return inline(line)
  })
  // A trailing newline needs a glyph after it, or the mirror ends one line short of the textarea.
  return lines.join("\n") + "​"
}
