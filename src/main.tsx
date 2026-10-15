import { render } from "preact"
import App from "./App"
import { boot } from "./lib/store"
import "./index.css"

try {
  const t = JSON.parse(localStorage.getItem("kestrel-theme") ?? "null")
  if (t?.dark) document.documentElement.classList.add("dark")
  if (t?.accent && t.accent !== "neutral") document.documentElement.dataset.accent = t.accent
} catch {}

boot()
render(<App />, document.getElementById("root")!)
