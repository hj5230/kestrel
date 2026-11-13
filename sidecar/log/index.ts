// The sidecar's logger. It writes no files: the Rust shell owns the log (one writer, one rotation and retention
// policy, and it also records what the sidecar cannot, like a crash, a kill or raw stderr). Each record leaves as
// one `KESTREL_LOG <json>` line on stdout, which the shell parses. Run by hand without the shell (browser development),
// records go to stderr instead. See docs/logging.md.
import fs from "node:fs";
import type { ClientLogRecord, LogLevel, LogRecord, LogSource, LogVerbosity } from "../../shared/protocol";
import { plainFields, scrub } from "../../shared/log-redact";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export const LOG_PREFIX = "KESTREL_LOG ";
export const LEVEL_PREFIX = "KESTREL_LOG_LEVEL ";

const ship = process.argv.includes("--log-stdout");
let current: LogVerbosity = "normal";

export type Fields = Record<string, unknown> | Error;

/** Whether a record at this level is kept under the current setting. Warnings and errors always are. */
export function enabled(level: LogLevel): boolean {
  return RANK[level] >= (current === "verbose" ? 0 : 1);
}

function put(line: string, sync: boolean) {
  if (sync) {
    try {
      fs.writeSync(1, line);
      return;
    } catch {}
  }
  process.stdout.write(line);
}

function emitRecord(rec: LogRecord, sync = false) {
  if (ship) put(`${LOG_PREFIX}${JSON.stringify(rec)}\n`, sync);
  else process.stderr.write(`${rec.time.slice(11, 23)} ${rec.level.toUpperCase().padEnd(5)} ${rec.mod}: ${rec.msg}${rec.fields ? " " + JSON.stringify(rec.fields) : ""}\n`);
}

function record(level: LogLevel, mod: string, msg: string, fields: Fields | undefined, src: LogSource = "sidecar", time = new Date().toISOString(), sync = false) {
  if (!enabled(level)) return;
  const rec: LogRecord = { time, level, src, mod, msg: scrub(msg) };
  if (fields instanceof Error) rec.fields = { error: plainFields({ e: fields }).e };
  else if (fields && Object.keys(fields).length) rec.fields = plainFields(fields);
  emitRecord(rec, sync);
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** For the way out: written with a blocking write so the line is out before the process is. */
  fatal(msg: string, fields?: Fields): void;
  /** An ordinary record on the way out (a clean exit), also written with a blocking write. */
  last(msg: string, fields?: Fields): void;
  /** Logs how long `fn` took, and that it failed if it threw; the error is rethrown. */
  time<T>(msg: string, fn: () => Promise<T> | T, fields?: Record<string, unknown>): Promise<T>;
}

export function logger(mod: string): Logger {
  const at = (level: LogLevel) => (msg: string, fields?: Fields) => record(level, mod, msg, fields);
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: (msg, fields) => record("error", mod, msg, fields, "sidecar", new Date().toISOString(), true),
    last: (msg, fields) => record("info", mod, msg, fields, "sidecar", new Date().toISOString(), true),
    async time(msg, fn, fields) {
      const t0 = performance.now();
      try {
        const r = await fn();
        record("debug", mod, msg, { ...fields, ms: Math.round(performance.now() - t0) });
        return r;
      } catch (e) {
        record("warn", mod, `${msg} failed`, { ...fields, ms: Math.round(performance.now() - t0), error: e });
        throw e;
      }
    },
  };
}

/** Records handed over by the front end when it has no native shell to write them (browser development). */
export function ingest(recs: ClientLogRecord[], src: LogSource) {
  for (const r of recs.slice(0, 200)) {
    const level: LogLevel = r.level in RANK ? r.level : "info";
    const time = typeof r.time === "string" && !Number.isNaN(Date.parse(r.time)) ? r.time : new Date().toISOString();
    record(level, String(r.mod ?? "ui").slice(0, 40), String(r.msg ?? ""), r.fields as Record<string, unknown> | undefined, src, time);
  }
}

/** Tells the shell which records the sidecar sends, so its own and the front end's follow the same setting. */
export function setVerbosity(v: LogVerbosity) {
  if (v === current) return;
  current = v;
  if (ship) put(`${LEVEL_PREFIX}${v}\n`, false);
  logger("log").info("verbosity changed", { verbosity: v });
}

export function verbosity(): LogVerbosity {
  return current;
}

/** Applies the saved setting at start-up; the shell is told even when it is the default, so the two always agree. */
export function configureLog(v: LogVerbosity) {
  current = v;
  if (ship) put(`${LEVEL_PREFIX}${v}\n`, false);
}

export function flushLogs(): Promise<void> {
  return new Promise((resolve) => process.stdout.write("", () => resolve()));
}
