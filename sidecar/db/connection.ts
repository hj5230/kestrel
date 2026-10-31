// The SQLite connection every store module shares, opened once at startup with the schema brought up to date.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export let db: Database;
export let dbPath = "";

export function importLegacyDb(dataDir: string, target: string, dev: boolean) {
  if (fs.existsSync(target)) return;
  const legacy = path.join(path.dirname(dataDir), "com.zhaoshangqi.helm", dev ? "helm-dev.db" : "helm.db");
  if (!fs.existsSync(legacy)) return;
  const old = new Database(legacy);
  try {
    old.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    old.close();
  }
}

export function connect(dataDir: string, dev: boolean) {
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, dev ? "kestrel-dev.db" : "kestrel.db");
  importLegacyDb(dataDir, dbPath, dev);
  db = new Database(dbPath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((db.query("SELECT version FROM _migrations").all() as { version: number }[]).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v)) return;
    db.transaction(() => {
      db.run(sql);
      db.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [v, Date.now()]);
    })();
  });
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {}
  db.run("UPDATE sessions SET status = 'idle' WHERE status IN ('running', 'waiting')");
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
