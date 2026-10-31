// Files on the Mac: @-completion, folder browsing, attachments, and recent working folders.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as store from "../db";
import { collapseHome, expandHome, which } from "../env";
import { describeLocalFiles, importLocalFile } from "../uploads";
import type { Handler } from "./types";
import { appInfo } from "../app-info";

const fileCache = new Map<string, { at: number; files: string[] }>();

function listProjectFiles(cwd: string): string[] {
  const hit = fileCache.get(cwd);
  if (hit && Date.now() - hit.at < 15000) return hit.files;
  let files: string[] = [];
  const rg = which("rg");
  if (rg) {
    const r = spawnSync(rg, ["--files", "--hidden", "--glob", "!.git", "--max-depth", "12"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
    files = (r.stdout || "").split("\n").filter(Boolean).slice(0, 50000);
  } else {
    const r = spawnSync("find", [".", "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
    files = (r.stdout || "").split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).slice(0, 50000);
  }
  fileCache.set(cwd, { at: Date.now(), files });
  return files;
}

function fuzzyScore(target: string, query: string): number {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  const base = path.basename(t);
  if (base === q) return 1000;
  if (base.startsWith(q)) return 800 - base.length;
  const i = t.indexOf(q);
  if (i >= 0) return 600 - i - t.length * 0.1;
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j < 0) return -1;
    score += j === ti ? 3 : 1;
    ti = j + 1;
  }
  return score - t.length * 0.05;
}

export const fileHandlers: Record<string, Handler> = {
  "fs.complete": ({ cwd, query, limit }: { cwd: string; query: string; limit?: number }) => {
    const root = expandHome(cwd);
    const files = listProjectFiles(root);
    const q = (query ?? "").trim();
    if (!q) return files.slice(0, limit ?? 30);
    return files
      .map((f) => ({ f, s: fuzzyScore(f, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit ?? 30)
      .map((x) => x.f);
  },
  "fs.dirs": ({ path: p }: { path: string }) => {
    const raw = expandHome(p || "~/");
    const dir = raw.endsWith("/") ? raw : path.dirname(raw);
    const prefix = raw.endsWith("/") ? "" : path.basename(raw).toLowerCase();
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith(".") && e.name.toLowerCase().startsWith(prefix))
        .slice(0, 40)
        .map((e) => collapseHome(path.join(dir, e.name)));
    } catch {
      return [];
    }
  },
  "fs.writeText": ({ path: p, content }: { path: string; content: string }) => {
    fs.writeFileSync(expandHome(p), content);
    return true;
  },
  "files.describe": ({ paths }: { paths: string[] }) => {
    if (!Array.isArray(paths) || !paths.length) return [];
    return describeLocalFiles(paths);
  },
  /** Copies a file the desktop user picked into the session. A phone uploads bytes instead; it must not name Mac paths. */
  "files.import": ({ sessionId, path: filePath }: { sessionId: string; path: string }) => importLocalFile(appInfo().dataDir, sessionId, filePath),
  "fs.recentDirs": () => {
    const rows = store.listSessions({}).map((s) => s.cwd);
    return [...new Set(rows)].slice(0, 12).map(collapseHome);
  },
};
