// Reading the log back for Settings → About → Logs. The Rust shell owns the files (on the phone, the phone's own),
// so these go straight to its commands rather than through the sidecar.
import type { LogInfo, LogPage, LogQuery } from "@shared/protocol"
import { isTauri } from "./platform"

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("The log is only available in the app")
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export const logInfo = () => call<LogInfo>("log_info")
export const logQuery = (query: LogQuery) => call<LogPage>("log_query", { query })
export const logExport = () => call<string>("log_export")
export const logReveal = () => call<void>("log_reveal")
