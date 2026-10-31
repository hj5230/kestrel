// Talking to the sidecar: RPC and uploads over HTTP on the desktop, or through the native pinned-TLS transport
// on the phone. The event stream is in events.ts and re-exported here.
import type { FileAttachment, ServerEvent } from "@shared/protocol"
import { isMobileApp, isTauri } from "./platform"
import { connectionGeneration } from "./connection-generation"
export { onServerEvent, onConnection, onRevoked, connectEvents, disconnectEvents } from "./events"

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
  upload?(sessionId: string, file: File): Promise<FileAttachment>
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
    async upload(sessionId, file) {
      await backend()
      const form = new FormData()
      form.set("sessionId", sessionId)
      form.set("file", file)
      const res = await fetch(`${base}/upload`, { method: "POST", headers: { "x-kestrel-token": token }, body: form })
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok || body.error) throw new RpcError(body.error ?? `HTTP ${res.status}`)
      return body as FileAttachment
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
      const streamId = crypto.randomUUID()
      const unEvent = await listen<{ streamId: string; event: string }>("remote://event", (e) => {
        if (e.payload.streamId !== streamId) return
        try {
          onEvent(JSON.parse(e.payload.event))
        } catch {}
      })
      const unStatus = await listen<{ stream_id: string; connected: boolean; code: number | null }>("remote://status", (e) => {
        if (e.payload.stream_id !== streamId || e.payload.connected) return
        unEvent()
        unStatus()
        onClose(e.payload.code ?? undefined)
      })
      try {
        await invoke("remote_events_connect", { streamId })
      } catch (e) {
        unEvent()
        unStatus()
        throw new RpcError(String(e))
      }
      return () => {
        unEvent()
        unStatus()
        invoke("remote_events_disconnect", { streamId }).catch(() => {})
      }
    },
  }
}

export const transport = isMobileApp ? nativeTransport() : httpTransport()

export async function rpc<T = any>(method: string, params: unknown = {}): Promise<T> {
  const generation = connectionGeneration.capture()
  const result = await transport.rpc(method, params)
  if (!connectionGeneration.current(generation)) throw new RpcError("Connection changed")
  return result as T
}

/** A file waiting to be stored with the session: either bytes from the page, or a path from the native picker. */
export interface StagedFile {
  name: string
  size?: number
  file?: File
  path?: string
}

/** Sends a file to the desktop's per-session upload folder over HTTP. */
export async function uploadFile(sessionId: string, file: File): Promise<FileAttachment> {
  if (!transport.upload) throw new RpcError("File upload is not available on this device")
  return transport.upload(sessionId, file)
}

/** The phone picked a file locally; the shell reads it and posts it to the paired Mac. */
async function uploadFromPhone(sessionId: string, path: string): Promise<FileAttachment> {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<FileAttachment>("remote_upload", { sessionId, path })
  } catch (e) {
    throw new RpcError(String(e))
  }
}

/** Turns whatever the composer is holding into stored attachments on the Mac that owns the session. */
export async function stageAttachments(sessionId: string, files: StagedFile[]): Promise<FileAttachment[]> {
  const out: FileAttachment[] = []
  for (const f of files) {
    if (f.file) out.push(await uploadFile(sessionId, f.file))
    else if (f.path) out.push(isMobileApp ? await uploadFromPhone(sessionId, f.path) : await rpc<FileAttachment>("files.import", { sessionId, path: f.path }))
  }
  return out
}

// ---------- event stream ----------
