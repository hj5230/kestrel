// Catches what nothing else will: stray console output, uncaught errors, Node warnings, the AI SDK's warnings, and
// the way the process ends. Installed once at start-up, before anything else runs.
import { version } from "../../package.json";
import { logger } from "./index";

const log = logger("process");
const seen = new Set<string>();

function text(args: unknown[]): string {
  return args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(" ");
}

export function installProcessHooks(opts: { dev: boolean; dataDir: string }) {
  const out = console.log.bind(console);
  // The shell reads one stdout line to learn the port, so that line must stay untouched. Everything else is a record.
  console.log = (...a: unknown[]) => {
    const line = text(a);
    if (line.startsWith("KESTREL_READY ")) out(line);
    else logger("console").info(line);
  };
  console.info = (...a: unknown[]) => logger("console").info(text(a));
  console.debug = (...a: unknown[]) => logger("console").debug(text(a));
  console.warn = (...a: unknown[]) => logger("console").warn(text(a));
  console.error = (...a: unknown[]) => logger("console").error(text(a));

  // The AI SDK repeats the same deprecation notice on every call; each distinct warning is worth one record.
  (globalThis as any).AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }: { warnings: unknown[]; provider?: string; model?: string }) => {
    for (const w of warnings) {
      const key = JSON.stringify(w);
      if (seen.has(key)) continue;
      seen.add(key);
      logger("ai-sdk").warn("provider warning", { provider, model, warning: w });
    }
  };

  process.on("warning", (w) => logger("process").warn(w.message, { name: w.name, code: (w as { code?: string }).code }));
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled promise rejection", reason instanceof Error ? reason : { reason });
  });
  process.on("uncaughtException", (e) => {
    log.fatal("uncaught exception, exiting", e);
    process.exit(1);
  });
  process.on("exit", (code) => {
    // A non-zero code that no handler above explained (process.exit(1) elsewhere) is worth an error; a clean one is not.
    if (code === 0) log.last("sidecar exiting", { code });
    else log.fatal("sidecar exiting with a failure code", { code });
  });

  log.info("sidecar starting", {
    version,
    dev: opts.dev,
    pid: process.pid,
    bun: Bun.version,
    platform: `${process.platform}-${process.arch}`,
    dataDir: opts.dataDir,
  });
}
