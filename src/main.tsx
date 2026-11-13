import { render } from "preact"
import App from "./App"
import { boot } from "./lib/store"
import { devicePreview, isMobileApp } from "./lib/platform"
import { trackVisualViewport } from "./lib/viewport"
import { routeExternalLinks } from "./lib/links"
import { initFeedback } from "./lib/feedback"
import { initLog } from "./lib/log"
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

if (devicePreview) void import("./lib/device-preview").then((m) => m.startDevicePreview())

initLog()
routeExternalLinks()
initFeedback()
boot()
render(<App />, document.getElementById("root")!)
