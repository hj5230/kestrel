declare global {
  interface Window {
    /** Injected by the mobile shell before any page script runs. */
    __KESTREL_PLATFORM__?: "mobile"
  }
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/**
 * The phone app: a remote control for the agent on a paired Mac. There is no local backend and
 * the Mac's file system is not reachable from here (no Finder, no native folder pickers).
 */
export const isMobileApp = isTauri && window.__KESTREL_PLATFORM__ === "mobile"

/** The desktop app, with the agent running as a local sidecar. */
export const isDesktopApp = isTauri && !isMobileApp

/** Touch-first device (phone, tablet): no hover, software keyboard. */
export const isTouch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches
