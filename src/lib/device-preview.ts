// Dev only: the phone interface in a desktop browser, framed as it sits on an iPhone 17 Pro Max. Sets the
// safe-area insets the app reads (env() is 0 off-device), draws the screen's rounded corners, the Dynamic
// Island and the home indicator on top. `&keyboard` adds a stand-in keyboard that shrinks the app the way the
// visual viewport does on the phone; `&still` ends every animation at once, so a screenshot shows the final
// frame even where the browser does not run animations (a hidden preview pane).
//
// Open /?device (or /?device&keyboard) at 440×956 with touch emulation, the Browser pane's custom size or
// Chrome's device toolbar, and screenshot it. It talks to the local sidecar, not through a paired Mac, so
// pairing screens and native calls (haptics, the photo picker) are out of its reach. See AGENTS.md.

/** iPhone 17 Pro Max, portrait, in points. */
const DEVICE = {
  width: 440,
  height: 956,
  radius: 62,
  insetTop: 62,
  insetBottom: 34,
  island: { width: 126, height: 37, top: 11 },
  keyboard: 336,
}

function el(style: Partial<CSSStyleDeclaration>, parent: HTMLElement): HTMLDivElement {
  const div = document.createElement("div")
  Object.assign(div.style, style)
  parent.appendChild(div)
  return div
}

export function startDevicePreview() {
  const params = new URLSearchParams(location.search)
  const keyboard = params.has("keyboard")
  const root = document.documentElement
  root.classList.add("mobile-app", "device-preview")
  root.style.setProperty("--inset-top", `${DEVICE.insetTop}px`)
  root.style.setProperty("--inset-bottom", `${DEVICE.insetBottom}px`)
  if (keyboard) {
    root.classList.add("keyboard-open")
    root.style.setProperty("--app-height", `${DEVICE.height - DEVICE.keyboard}px`)
    root.style.setProperty("--kb", `${DEVICE.keyboard}px`)
  }
  if (params.has("still")) {
    const style = document.createElement("style")
    style.textContent = "*, *::before, *::after { animation-delay: 0s !important; animation-duration: 0s !important; transition: none !important; }"
    document.head.appendChild(style)
  }
  if (innerWidth !== DEVICE.width || innerHeight !== DEVICE.height) {
    console.warn(`[device preview] viewport is ${innerWidth}×${innerHeight}; set it to ${DEVICE.width}×${DEVICE.height} for a true frame`)
  }

  const overlay = el({ position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" }, document.body)
  overlay.setAttribute("aria-hidden", "true")
  overlay.dataset.devicePreview = ""
  // Everything outside the rounded screen is bezel.
  el({ position: "absolute", inset: "0", borderRadius: `${DEVICE.radius}px`, boxShadow: "0 0 0 400px #000" }, overlay)
  const { island } = DEVICE
  el(
    {
      position: "absolute",
      top: `${island.top}px`,
      left: "50%",
      width: `${island.width}px`,
      height: `${island.height}px`,
      marginLeft: `${-island.width / 2}px`,
      borderRadius: `${island.height / 2}px`,
      background: "#000",
    },
    overlay,
  )
  if (keyboard) {
    const dark = root.classList.contains("dark")
    const kb = el(
      {
        position: "absolute",
        left: "0",
        right: "0",
        bottom: "0",
        height: `${DEVICE.keyboard}px`,
        background: dark ? "#2c2c2e" : "#d1d4d9",
        display: "grid",
        gridTemplateRows: "repeat(4, 42px)",
        alignContent: "start",
        rowGap: "12px",
        padding: "8px 3px 0",
      },
      overlay,
    )
    for (const keys of [10, 9, 9, 4]) {
      const row = el({ display: "flex", justifyContent: "center", gap: "6px" }, kb)
      for (let i = 0; i < keys; i++) el({ width: keys === 4 ? "80px" : "37px", borderRadius: "5px", background: dark ? "#6b6b6e" : "#fff" }, row)
    }
  }
  el(
    {
      position: "absolute",
      bottom: "8px",
      left: "50%",
      width: "140px",
      height: "5px",
      marginLeft: "-70px",
      borderRadius: "3px",
      background: root.classList.contains("dark") ? "#fff" : "#000",
      opacity: "0.85",
    },
    overlay,
  )
}
