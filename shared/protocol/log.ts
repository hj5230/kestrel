// Logging: the record every part of the app writes (sidecar, Rust shell, desktop and phone UI), and what the
// in-app log viewer asks for. One JSON object per line on disk; see docs/logging.md.

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Who wrote it: the Bun sidecar, the Rust shell, the desktop UI, the phone UI, or the phone's native layer. */
export type LogSource = "sidecar" | "shell" | "ui" | "phone" | "phone-native";

/** The setting: normal keeps info and above; verbose adds debug. Warnings and errors are always kept. */
export type LogVerbosity = "normal" | "verbose";

export interface LogRecord {
  /** ISO 8601, UTC, millisecond precision. */
  time: string;
  level: LogLevel;
  src: LogSource;
  /** The area that wrote it: "agent", "rpc", "remote", "mcp", "update", "net", … */
  mod: string;
  msg: string;
  fields?: Record<string, unknown>;
}

/** What a client sends; the sidecar adds the source. */
export type ClientLogRecord = Omit<LogRecord, "src"> & { src?: "phone-native" };

export interface LogFileInfo {
  name: string;
  size: number;
  modified: number;
  /** Routine files (debug, info) rotate out quickly; important ones (warn, error) are kept much longer. */
  tier: "routine" | "important";
}

export interface LogInfo {
  dir: string;
  /** Debug records are being kept. */
  verbose: boolean;
  files: LogFileInfo[];
  routineDays: number;
  importantDays: number;
}

export interface LogQuery {
  tier: "routine" | "important";
  minLevel?: LogLevel;
  module?: string;
  src?: LogSource;
  search?: string;
  /** Newest records to return, oldest first. Default 300. */
  limit?: number;
}

export interface LogPage {
  records: LogRecord[];
  /** Every module seen in the files read, for the filter menu. */
  mods: string[];
  /** More matches existed than `limit`. */
  truncated: boolean;
}
