import type { ServerEvent } from "@shared/protocol"

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

let base = ""
let token = ""
let ready: Promise<void> | null = null

async function resolveBackend() {
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
  base = params.get("backend") ?? import.meta.env.VITE_HELM_BACKEND ?? "http://127.0.0.1:47821"
  token = params.get("token") ?? import.meta.env.VITE_HELM_TOKEN ?? "dev"
}

export function backendReady() {
  if (!ready) ready = resolveBackend()
  return ready
}

export class RpcError extends Error {}

export async function rpc<T = any>(method: string, params: unknown = {}): Promise<T> {
  await backendReady()
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-helm-token": token },
    body: JSON.stringify({ method, params }),
  })
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (body.error) throw new RpcError(body.error)
  return body.result as T
}

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
const statusListeners = new Set<(connected: boolean) => void>()
let socket: WebSocket | null = null
let retry = 0

export function onServerEvent(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function onConnection(fn: (connected: boolean) => void) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

export async function connectEvents() {
  try {
    await backendReady()
  } catch {
    ready = null
    setTimeout(() => connectEvents(), 1000)
    return
  }
  const url = `${base.replace(/^http/, "ws")}/events?token=${encodeURIComponent(token)}`
  const ws = new WebSocket(url)
  socket = ws
  ws.onopen = () => {
    retry = 0
    statusListeners.forEach((fn) => fn(true))
  }
  ws.onmessage = (ev) => {
    let e: ServerEvent
    try {
      e = JSON.parse(ev.data)
    } catch {
      return
    }
    listeners.forEach((fn) => fn(e))
  }
  ws.onclose = () => {
    if (socket !== ws) return
    statusListeners.forEach((fn) => fn(false))
    if (isTauri) ready = null
    const delay = Math.min(5000, 300 * 2 ** retry++)
    setTimeout(() => connectEvents(), delay)
  }
}
