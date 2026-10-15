import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = os.homedir();

export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

export function collapseHome(p: string): string {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

export const SHELL = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

let shellEnv: Record<string, string> = { ...(process.env as Record<string, string>) };

let resolving: Promise<void> | null = null;

export function shellEnvReady(): Promise<void> {
  return resolving ?? Promise.resolve();
}

export function resolveShellEnv(): Promise<void> {
  resolving ??= doResolve();
  return resolving;
}

async function doResolve(): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const marker = "__KESTREL_ENV__";
    const proc = Bun.spawn([SHELL, "-ilc", `printf '${marker}'; env -0; printf '${marker}'`], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, KESTREL_RESOLVING_ENV: "1" },
    });
    const timer = setTimeout(() => proc.kill(), 8000);
    const text = await new Response(proc.stdout).text();
    clearTimeout(timer);
    const start = text.indexOf(marker);
    const end = text.lastIndexOf(marker);
    if (start < 0 || end <= start) return;
    const body = text.slice(start + marker.length, end);
    const env: Record<string, string> = {};
    for (const entry of body.split("\0")) {
      const i = entry.indexOf("=");
      if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1);
    }
    delete env.KESTREL_RESOLVING_ENV;
    if (env.PATH) shellEnv = { ...shellEnv, ...env };
  } catch {
    // fall back to inherited environment
  }
}

export function getShellEnv(): Record<string, string> {
  return shellEnv;
}

export function which(bin: string): string | null {
  const dirs = (shellEnv.PATH || process.env.PATH || "").split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}
