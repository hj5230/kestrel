import { startMergeJobs } from "./merge-jobs";
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dev = process.argv.includes("--dev");
const dataDir = arg("data-dir") ?? path.join(os.homedir(), "Library", "Application Support", "com.zhaoshangqi.kestrel");
const port = Number(arg("port") ?? (dev ? 47821 : 0));
const token = arg("token") ?? (dev ? "dev" : crypto.randomUUID());

for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];

loadCatalogCache(dataDir);
openDb(dataDir, dev);
try { initializeMemory(); } catch (e) { console.error("Memory initialization failed:", e instanceof Error ? e.message : String(e)); }
const fillModels = () =>
  backfillModels((model) => {
    const provider = getProvider(model.providerId);
    return provider ? lookupFacts(provider.kind, provider.baseUrl, model.id, model.metadataSource === "codex" ? "codex" : undefined) : null;
  });
fillModels();
const envReady = resolveShellEnv();
const server = startServer({ port, token, dataDir, dev });
console.log(`KESTREL_READY ${JSON.stringify({ port: server.port, token })}`);
initRemote(dataDir);
startMergeJobs();

// The catalog is large and the network copy can be a day old. Refresh after the app is up, then
// fill any model fields that are still at the generic default.
refreshCatalog(dataDir, proxiedFetch)
  .then(() => {
    if (fillModels()) emit({ type: "models_updated" });
  })
  .catch(() => {});

// Conversations from other apps on this Mac, indexed in the background shortly after start
openHistoryDb(path.join(dataDir, dev ? "history-dev.db" : "history.db"));
setHistorySources(getSettings().historySources);
setTimeout(() => syncHistory().catch(() => {}), 3000);

envReady.then(() => {
  const s = getSettings();
  if (s.memoryEnabled && memoryConfigured(s)) void prepareMemory(s).catch(() => {});
  startMemoryJobs();
  return startMcp();
}).catch(() => {});

async function shutdown() {
  cancelMemoryWork();
  stopMemoryJobs();
  shutdownRemote();
  killAllShells();
  await Promise.race([stopAllMcp(), new Promise((r) => setTimeout(r, 1500))]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (process.argv.includes("--watch-stdin")) {
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.stdin.resume();
}
