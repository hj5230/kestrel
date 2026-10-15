import os from "node:os";
import path from "node:path";
import { openDb } from "./db";
import { resolveShellEnv } from "./env";
import { startMcp, stopAllMcp } from "./mcp";
import { killAllShells } from "./tools/bash";
import { startServer } from "./server";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dev = process.argv.includes("--dev");
const dataDir = arg("data-dir") ?? path.join(os.homedir(), "Library", "Application Support", "com.zhaoshangqi.helm");
const port = Number(arg("port") ?? (dev ? 47821 : 0));
const token = arg("token") ?? (dev ? "dev" : crypto.randomUUID());

for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];

openDb(dataDir, dev);
const envReady = resolveShellEnv();
const server = startServer({ port, token, dataDir, dev });
console.log(`HELM_READY ${JSON.stringify({ port: server.port, token })}`);

envReady.then(() => startMcp()).catch(() => {});

async function shutdown() {
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
