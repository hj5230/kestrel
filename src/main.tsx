import { render } from "preact"
import App from "./App"
import { boot } from "./lib/store"
import { isMobileApp } from "./lib/platform"
import { trackVisualViewport } from "./lib/viewport"
import { routeExternalLinks } from "./lib/links"
import "./index.css"

if (isMobileApp) {
  document.documentElement.classList.add("mobile-app")
  trackVisualViewport()
}

try {
  const t = JSON.parse(localStorage.getItem("kestrel-theme") ?? "null")
  if (t?.dark) document.documentElement.classList.add("dark")
  if (t?.accent && t.accent !== "neutral") document.documentElement.dataset.accent = t.accent
} catch {}

routeExternalLinks()
boot()
render(<App />, document.getElementById("root")!)
