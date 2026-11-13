// The server's event stream: one connection, reconnecting with backoff, dropped after the app sits in the
// background long enough that the stream is surely stale. Listeners hear events, connection changes and revocation.
import type { ServerEvent } from "@shared/protocol"
import { connectionGeneration } from "./connection-generation"
import { REVOKED_CLOSE_CODE, transport } from "./api"
import { logger } from "./log"

const log = logger("events")

export type Listener = (e: ServerEvent) => void

export const listeners = new Set<Listener>()

export const statusListeners = new Set<(connected: boolean) => void>()

export const revokedListeners = new Set<() => void>()

export let close: (() => void) | null = null

export let connecting = false

export let live = false

export let retry = 0

export let retryTimer: ReturnType<typeof setTimeout> | null = null

export let stopped = true

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

export function setLive(next: boolean) {
  if (live === next) return
  live = next
  if (next) log.info("event stream connected", { afterRetries: retry })
  else log.warn("event stream lost")
  statusListeners.forEach((fn) => fn(next))
}

export function scheduleReconnect(delay = Math.min(5000, 300 * 2 ** retry++)) {
  if (stopped) return
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void open()
  }, delay)
}

export async function open() {
  if (stopped || connecting || live) return
  connecting = true
  const generation = connectionGeneration.capture()
  try {
    const opened = await transport.openEvents(
      (e) => { if (connectionGeneration.current(generation)) listeners.forEach((fn) => fn(e)) },
      (code) => {
        if (!connectionGeneration.current(generation)) return
        close = null
        setLive(false)
        log.warn("event stream closed", { code })
        if (code === REVOKED_CLOSE_CODE) {
          log.error("this device was revoked by the Mac")
          stopped = true
          revokedListeners.forEach((fn) => fn())
          return
        }
        scheduleReconnect()
      },
    )
    if (!connectionGeneration.current(generation) || stopped) { opened(); return }
    close = opened
    retry = 0
    setLive(true)
  } catch (e) {
    if (!connectionGeneration.current(generation)) return
    log.warn("event stream could not open", { error: e, retry })
    if (String(e).includes("unauthorized")) {
      stopped = true
      revokedListeners.forEach((fn) => fn())
    } else {
      scheduleReconnect()
    }
  } finally {
    if (connectionGeneration.current(generation)) connecting = false
  }
}

export function connectEvents() {
  stopped = false
  retry = 0
  void open()
}

export function disconnectEvents() {
  connectionGeneration.invalidate()
  connecting = false
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
export const STALE_AFTER_MS = 10_000

export let hiddenAt = 0
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
