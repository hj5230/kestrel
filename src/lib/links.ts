// Tauri's webview ignores target="_blank", so links in replies, tool output and settings did nothing on click.
// One listener on the document hands every external link to the system browser (Safari on the phone).
import { isTauri } from "./platform"

const EXTERNAL = /^(https?:|mailto:)/i

export function routeExternalLinks() {
  if (!isTauri) return
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    const href = a?.getAttribute("href")
    if (!href || !EXTERNAL.test(href)) return
    e.preventDefault()
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(href)).catch((err) => console.error("open link failed", err))
  })
}
