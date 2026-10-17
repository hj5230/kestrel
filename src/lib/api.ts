import type { ServerEvent } from "@shared/protocol"
import { isMobileApp, isTauri } from "./platform"

export { isTauri }

export class RpcError extends Error {}

/** WebSocket close code the Mac uses when this phone's pairing was revoked. */
export const REVOKED_CLOSE_CODE = 4401

/**
 * How the UI reaches the agent backend. Desktop and the browser dev build talk HTTP/WebSocket to
 * a sidecar on localhost; the phone goes through the native shell, which pins the paired Mac's
 * certificate. Everything above this interface is shared.
 */
interface Transport {
  rpc(method: string, params: unknown): Promise<unknown>
  /** Resolves once the event stream is live; `onClose` fires when it drops. */
  openEvents(onEvent: (e: ServerEvent) => void, onClose: (code?: number) => void): Promise<() => void>
}

function httpTransport(): Transport {
  let base = ""
  let token = ""
  let ready: Promise<void> | null = null

  async function resolve() {
    if (isTauri) {
      const { invoke } = await import("@tauri-apps/api/core")
      for (let i = 0; i < 200; i++) {
        const info = await invoke<{ port: number; token: string } | null>("backend_info")
        if (info) {
          base = `http://127.0.0.1:${info.port}`
          token = info.token
          return
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error("Background service start-up timed out")
    }
    const params = new URLSearchParams(location.search)
    base = params.get("backend") ?? import.meta.env.VITE_KESTREL_BACKEND ?? "http://127.0.0.1:47821"
    token = params.get("token") ?? import.meta.env.VITE_KESTREL_TOKEN ?? "dev"
  }

  const backend = () => {
    if (!ready) ready = resolve().catch((e) => ((ready = null), Promise.reject(e)))
    return ready
  }

  return {
    async rpc(method, params) {
      await backend()
      const res = await fetch(`${base}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-kestrel-token": token },
        body: JSON.stringify({ method, params }),
      })
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (body.error) throw new RpcError(body.error)
      return body.result
    },
    async openEvents(onEvent, onClose) {
      await backend()
      const ws = new WebSocket(`${base.replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`)
      await new Promise<void>((ok, fail) => {
        ws.onopen = () => ok()
        ws.onerror = () => fail(new Error("event stream failed"))
      })
      ws.onmessage = (ev) => {
        try {
          onEvent(JSON.parse(ev.data))
        } catch {}
      }
      ws.onclose = (ev) => {
        // The desktop sidecar may have been restarted on a new port/token.
        if (isTauri) ready = null
        onClose(ev.code)
      }
      return () => {
        ws.onclose = null
        ws.close()
      }
    },
  }
}

function nativeTransport(): Transport {
  const core = import("@tauri-apps/api/core")
  const events = import("@tauri-apps/api/event")
  return {
    async rpc(method, params) {
      const { invoke } = await core
      try {
        return await invoke("remote_rpc", { method, params })
      } catch (e) {
        throw new RpcError(String(e))
      }
    },
    async openEvents(onEvent, onClose) {
      const [{ invoke }, { listen }] = await Promise.all([core, events])
      const unEvent = await listen<string>("remote://event", (e) => {
        try {
          onEvent(JSON.parse(e.payload))
        } catch {}
      })
      const unStatus = await listen<{ connected: boolean; code: number | null }>("remote://status", (e) => {
        if (e.payload.connected) return
        unEvent()
        unStatus()
        onClose(e.payload.code ?? undefined)
      })
      try {
        await invoke("remote_events_connect")
      } catch (e) {
        unEvent()
        unStatus()
        throw new RpcError(String(e))
      }
      return () => {
        unEvent()
        unStatus()
        invoke("remote_events_disconnect").catch(() => {})
      }
    },
  }
}

const transport = isMobileApp ? nativeTransport() : httpTransport()

export function rpc<T = any>(method: string, params: unknown = {}): Promise<T> {
  return transport.rpc(method, params) as Promise<T>
}

// ---------- event stream ----------

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
const statusListeners = new Set<(connected: boolean) => void>()
const revokedListeners = new Set<() => void>()
let close: (() => void) | null = null
let connecting = false
let live = false
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true

export function onServerEvent(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function onConnection(fn: (connected: boolean) => void) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/** The backend refused this device (mobile: pairing revoked on the Mac). Reconnecting stops. */
export function onRevoked(fn: () => void) {
  revokedListeners.add(fn)
  return () => revokedListeners.delete(fn)
}

function setLive(next: boolean) {
  if (live === next) return
  live = next
  statusListeners.forEach((fn) => fn(next))
}

function scheduleReconnect(delay = Math.min(5000, 300 * 2 ** retry++)) {
  if (stopped) return
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void open()
  }, delay)
}

async function open() {
  if (stopped || connecting || live) return
  connecting = true
  try {
    close = await transport.openEvents(
      (e) => listeners.forEach((fn) => fn(e)),
      (code) => {
        close = null
        setLive(false)
        if (code === REVOKED_CLOSE_CODE) {
          stopped = true
          revokedListeners.forEach((fn) => fn())
          return
        }
        scheduleReconnect()
      },
    )
    retry = 0
    setLive(true)
  } catch (e) {
    if (String(e).includes("unauthorized")) {
      stopped = true
      revokedListeners.forEach((fn) => fn())
    } else {
      scheduleReconnect()
    }
  } finally {
    connecting = false
  }
}

export function connectEvents() {
  stopped = false
  retry = 0
  void open()
}

export function disconnectEvents() {
  stopped = true
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  close?.()
  close = null
  setLive(false)
}

// Coming back to the foreground (a phone unlocking, a laptop waking) should not wait out the
// backoff. After a longer absence the stream may look alive but be dead (iOS kills sockets of
// suspended apps without telling anyone), so rebuild it; the reconnect also resyncs state.
const STALE_AFTER_MS = 10_000
let hiddenAt = 0
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now()
      return
    }
    if (stopped) return
    if (live && Date.now() - hiddenAt > STALE_AFTER_MS) {
      close?.()
      close = null
      setLive(false)
    }
    if (live) return
    retry = 0
    scheduleReconnect(0)
  })
}
