// Tailscale on the Mac: lets a paired phone reach Kestrel away from the local Wi-Fi.
//
// Kestrel does not bundle Tailscale; it drives the user's installation through its CLI (the
// standalone/App Store app ships one inside its bundle, Homebrew installs `tailscale`). Everything
// here is best effort: a missing or stopped Tailscale is a normal state, not an error.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import type { TailscaleStatus } from "../shared/protocol";
import { which } from "./env";
import { logger } from "./log";

const log = logger("tailscale");

const APP_BUNDLE = "/Applications/Tailscale.app";
const APP_CLI = `${APP_BUNDLE}/Contents/MacOS/Tailscale`;
export const DOWNLOAD_URL = "https://tailscale.com/download/mac";

function cli(): string | null {
  return which("tailscale") ?? [APP_CLI, "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"].find((p) => fs.existsSync(p)) ?? null;
}

let cached: { at: number; status: TailscaleStatus } | null = null;

export function tailscaleStatus(maxAgeMs = 5000): TailscaleStatus {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.status;
  const status = readStatus();
  cached = { at: Date.now(), status };
  return status;
}

function readStatus(): TailscaleStatus {
  const base: TailscaleStatus = { state: "not_installed", tailnet: null, dnsName: null, ips: [], appInstalled: fs.existsSync(APP_BUNDLE) };
  const bin = cli();
  if (!bin) return base;
  const r = spawnSync(bin, ["status", "--json"], { encoding: "utf8", timeout: 3000 });
  let s: any;
  try {
    s = JSON.parse(r.stdout);
  } catch {
    // Installed, but the daemon / app is not running (or not answering).
    log.debug("tailscale is not answering", { exit: r.status, signal: r.signal });
    return { ...base, state: "not_running" };
  }
  const backend = String(s.BackendState ?? "");
  const state: TailscaleStatus["state"] =
    backend === "Running" ? "running" : backend === "NeedsLogin" || backend === "NeedsMachineAuth" ? "needs_login" : backend === "Stopped" ? "stopped" : "not_running";
  return {
    ...base,
    state,
    tailnet: s.CurrentTailnet?.Name ?? null,
    dnsName: state === "running" ? String(s.Self?.DNSName ?? "").replace(/\.$/, "") || null : null,
    ips: state === "running" ? ((s.Self?.TailscaleIPs ?? s.TailscaleIPs ?? []) as string[]).filter((ip) => !ip.includes(":")) : [],
  };
}

/**
 * Brings Tailscale up. When a login is needed the CLI prints an auth URL and waits for the browser
 * flow to finish; we return the URL as soon as it appears and let the process finish on its own.
 */
export function tailscaleConnect(): Promise<{ authUrl: string | null }> {
  const bin = cli();
  if (!bin) return Promise.reject(new Error("Tailscale is not installed"));
  const args = tailscaleStatus(0).state === "needs_login" ? ["login"] : ["up"];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    // Already logged in and connecting: nothing to show, the status poll picks up the result.
    const timer = setTimeout(() => done(() => resolve({ authUrl: null })), 15000);
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cached = null;
      fn();
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0];
      if (url) done(() => resolve({ authUrl: url }));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => done(() => reject(e)));
    child.on("exit", (code) => done(() => (code === 0 ? resolve({ authUrl: null }) : reject(new Error(output.trim() || `tailscale ${args[0]} exited with ${code}`)))));
  });
}

export function openTailscaleApp() {
  spawnSync("open", ["-a", "Tailscale"]);
  cached = null;
}
