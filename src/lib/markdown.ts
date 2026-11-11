import DOMPurify from "dompurify"
import hljs from "highlight.js/lib/common"
import { Marked, type MarkedExtension } from "marked"
import { lang, t } from "./i18n"

// Replies follow Markdown's own line rules; what the user typed keeps every line break they made.
const marked = new Marked({ gfm: true, breaks: false })
const typed = new Marked({ gfm: true, breaks: true })

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

const extension: MarkedExtension = {
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0]
      let html: string
      try {
        html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : escapeHtml(text)
      } catch {
        html = escapeHtml(text)
      }
      const label = escapeHtml(language || "text")
      return `<pre><div class="code-head"><span>${label}</span><button type="button" class="copy-code" data-copy>${t("common.copy")}</button></div><code class="hljs">${html}</code></pre>`
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const t = title ? ` title="${escapeHtml(title)}"` : ""
      return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noreferrer">${text}</a>`
    },
  },
}
marked.use(extension)
typed.use(extension)
// A pasted snippet of HTML is something the user is showing, not markup to render.
typed.use({ renderer: { html: ({ text }) => escapeHtml(text) } })

const cache = new Map<string, string>()

export function renderMarkdown(src: string, opts: { breaks?: boolean } = {}): string {
  const key = lang.value + (opts.breaks ? "\u0001" : "\u0000") + src
  const hit = cache.get(key)
  if (hit) return hit
  const raw = (opts.breaks ? typed : marked).parse(src, { async: false }) as string
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "data-copy"] })
  if (cache.size > 400) cache.clear()
  cache.set(key, html)
  return html
}

export function highlight(code: string, language?: string): string {
  try {
    if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language }).value
    return escapeHtml(code)
  } catch {
    return escapeHtml(code)
  }
}

export function languageFromPath(p: string): string | undefined {
  const ext = p.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", rb: "ruby", php: "php",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", css: "css", scss: "scss", html: "xml", xml: "xml", vue: "xml",
    json: "json", md: "markdown", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", sh: "bash", zsh: "bash", bash: "bash",
    sql: "sql", lua: "lua", r: "r", diff: "diff",
  }
  return map[ext]
}
