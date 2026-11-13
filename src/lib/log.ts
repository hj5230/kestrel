// The front end's logger. Records are scrubbed here, batched, and handed to the Rust shell, which is the only writer
// of the log (desktop window and phone alike). In a plain browser (development) there is no shell, so they go to the
// sidecar's `log.write` instead. Debug records are dropped here unless verbose logging is on, to spare the bridge.
import type { ClientLogRecord, LogLevel, LogVerbosity } from "@shared/protocol"
import { plainFields, scrub } from "@shared/log-redact"
import { isMobileApp, isTauri } from "./platform"

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const FLUSH_MS = 1000
const MAX_BUFFER = 500

let verbose = false
let buffer: ClientLogRecord[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let sending = false

async function send(records: ClientLogRecord[]) {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("log_write", { records })
    return
  }
  // Imported lazily: api.ts logs too, and the two must not wait on each other at load.
  const { transport } = await import("./api")
  await transport.rpc("log.write", { records })
}

async function flush() {
  timer = null
  if (sending || !buffer.length) return
  const batch = buffer.splice(0, 100)
  sending = true
  try {
    await send(batch)
  } catch {
    // The log is the one thing that must never throw into the app. Keep a bounded backlog and try again later.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFER)
    timer = setTimeout(flush, 5000)
    sending = false
    return
  }
  sending = false
  if (buffer.length) void flush()
}

function record(level: LogLevel, mod: string, msg: string, fields?: Record<string, unknown> | unknown) {
  if (level === "debug" && !verbose) return
  const rec: ClientLogRecord = { time: new Date().toISOString(), level, mod, msg: scrub(msg) }
  if (fields instanceof Error) rec.fields = { error: plainFields({ e: fields }).e }
  else if (fields && typeof fields === "object" && Object.keys(fields).length) rec.fields = plainFields(fields as Record<string, unknown>)
  buffer.push(rec)
  if (buffer.length > MAX_BUFFER) buffer.shift()
  if (RANK[level] >= RANK.error) void flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

export interface Log {
  debug(msg: string, fields?: Record<string, unknown> | unknown): void
  info(msg: string, fields?: Record<string, unknown> | unknown): void
  warn(msg: string, fields?: Record<string, unknown> | unknown): void
  error(msg: string, fields?: Record<string, unknown> | unknown): void
}

export function logger(mod: string): Log {
  return {
    debug: (m, f) => record("debug", mod, m, f),
    info: (m, f) => record("info", mod, m, f),
    warn: (m, f) => record("warn", mod, m, f),
    error: (m, f) => record("error", mod, m, f),
  }
}

/** Follows the saved setting. The shell is told too, so what it writes itself (and the phone's native layer) agrees. */
export function setLogVerbosity(v: LogVerbosity) {
  const next = v === "verbose"
  if (next === verbose) return
  verbose = next
  if (isTauri) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("log_set_verbose", { verbose: next })).catch(() => {})
}

/** Everything nobody else will report: uncaught errors, rejected promises, console warnings and errors, and the app
 *  going to the background (after which the web view may be killed before it can flush). */
export function initLog() {
  const log = logger("ui")
  window.addEventListener("error", (e) => log.error("uncaught error", { message: e.message, at: `${e.filename ?? ""}:${e.lineno ?? 0}:${e.colno ?? 0}`, error: e.error }))
  window.addEventListener("unhandledrejection", (e) => log.error("unhandled promise rejection", e.reason instanceof Error ? e.reason : { reason: e.reason }))
  const text = (a: unknown[]) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? (x.stack ?? x.message) : safe(x))).join(" ")
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console)
    console[level] = (...a: unknown[]) => {
      original(...a)
      record(level, "console", text(a))
    }
  }
  document.addEventListener("visibilitychange", () => {
    log.debug(document.visibilityState === "hidden" ? "app went to the background" : "app came to the foreground")
    if (document.visibilityState === "hidden") void flush()
  })
  window.addEventListener("pagehide", () => void flush())
  window.addEventListener("online", () => log.info("network came back"))
  window.addEventListener("offline", () => log.warn("network went away"))
  log.info("ui started", { platform: isMobileApp ? "phone" : isTauri ? "desktop" : "browser", ua: navigator.userAgent, size: `${innerWidth}x${innerHeight}` })
}

function safe(x: unknown): string {
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}
