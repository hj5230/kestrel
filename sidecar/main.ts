import { startMergeJobs } from "./merge-jobs";
import { initUpdater } from "./update/updater";
import { version } from "../package.json";
import os from "node:os";
import path from "node:path";
import { loadCatalogCache, lookupFacts, refreshCatalog } from "./catalog";
import { backfillModels, getProvider, getSettings, openDb } from "./db";
import { emit } from "./hub";
import { proxiedFetch } from "./providers";
import { resolveShellEnv } from "./env";
import { openHistoryDb, setHistorySources, syncHistory } from "./history";
import { startMcp, stopAllMcp } from "./mcp";
import { killAllShells } from "./tools/bash";
import { initRemote, shutdownRemote } from "./remote";
import { startServer } from "./server";
import { cancelMemoryWork, initializeMemory, prepareMemory } from "./memory-retrieval";
import { memoryConfigured } from "./memory-config";
import { startMemoryJobs, stopMemoryJobs } from "./memory-jobs";
import { configureLog, flushLogs, logger } from "./log";
import { installProcessHooks } from "./log/hooks";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dev = process.argv.includes("--dev");
const dataDir = arg("data-dir") ?? path.join(os.homedir(), "Library", "Application Support", "com.zhaoshangqi.kestrel");
const port = Number(arg("port") ?? (dev ? 47821 : 0));
const token = arg("token") ?? (dev ? "dev" : crypto.randomUUID());

// Logging comes first so everything after it, including a crash during start-up, leaves a record. The sidecar writes
// no files: with --log-stdout the shell reads its records and owns the log; run by hand they go to stderr.
installProcessHooks({ dev, dataDir });
const log = logger("main");

for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];

loadCatalogCache(dataDir);
openDb(dataDir, dev);
configureLog(getSettings().logLevel);
log.info("database ready", { dev });
try { initializeMemory(); } catch (e) { log.error("memory initialization failed", e instanceof Error ? e : { e }); }
const fillModels = () =>
  backfillModels((model) => {
    const provider = getProvider(model.providerId);
    return provider ? lookupFacts(provider.kind, provider.baseUrl, model.id, model.metadataSource === "codex" ? "codex" : undefined) : null;
  });
fillModels();
const envReady = resolveShellEnv();
const server = startServer({ port, token, dataDir, dev });
log.info("listening", { port: server.port });
console.log(`KESTREL_READY ${JSON.stringify({ port: server.port, token })}`);
initRemote(dataDir);
startMergeJobs();
initUpdater({ dataDir, version, dev });

// The catalog is large and the network copy can be a day old. Refresh after the app is up, then
// fill any model fields that are still at the generic default.
refreshCatalog(dataDir, proxiedFetch)
  .then(() => {
    if (fillModels()) emit({ type: "models_updated" });
  })
  .catch((e) => log.warn("model catalog refresh failed", e));

// Conversations from other apps on this Mac, indexed in the background shortly after start
openHistoryDb(path.join(dataDir, dev ? "history-dev.db" : "history.db"));
setHistorySources(getSettings().historySources);
setTimeout(() => syncHistory().catch((e) => logger("history").warn("background sync failed", e)), 3000);

envReady.then(() => {
  const s = getSettings();
  if (s.memoryEnabled && memoryConfigured(s)) void prepareMemory(s).catch((e) => logger("memory").warn("prepare failed", e));
  startMemoryJobs();
  return startMcp();
}).catch((e) => log.error("background start-up failed", e));

async function shutdown(signal?: string) {
  log.info("shutting down", { signal });
  cancelMemoryWork();
  stopMemoryJobs();
  shutdownRemote();
  killAllShells();
  await Promise.race([stopAllMcp(), new Promise((r) => setTimeout(r, 1500))]);
  await flushLogs();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
if (process.argv.includes("--watch-stdin")) {
  process.stdin.on("end", () => void shutdown("stdin closed"));
  process.stdin.on("close", () => void shutdown("stdin closed"));
  process.stdin.resume();
}
