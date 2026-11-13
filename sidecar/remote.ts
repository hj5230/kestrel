// Remote access for the mobile app.
//
// A second listener on the LAN, separate from the loopback one the desktop window uses. It serves
// the same API over TLS with a self-signed certificate whose SHA-256 the phone pins (learned from
// the pairing QR code), so no CA or domain is needed and nobody on the network can impersonate the
// Mac. Phones authenticate with a per-device token obtained once by redeeming a short-lived,
// single-use pairing code; tokens are stored hashed and can be revoked individually.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { Server, ServerWebSocket } from "bun";
import type { RemoteStatus } from "../shared/protocol";
import * as store from "./db";
import { emit } from "./hub";
import { handleApi, registerHandlers, socketHandlers, type Caller, type SocketData } from "./server";
import { setSleepDisabled, sleepDisabled } from "./power";
import { DOWNLOAD_URL, openTailscaleApp, tailscaleConnect, tailscaleStatus } from "./tailscale";
import { certPaths, ensureCertificate, fingerprint, candidateHosts, serverName } from "./remote/identity";
import { logger } from "./log";

const log = logger("remote");

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;

export let dataDir = "";
let server: Server<SocketData> | null = null;
let listenError: string | null = null;
let pairing: { code: string; expiresAt: number; failures: number } | null = null;
let pairingTimer: ReturnType<typeof setTimeout> | null = null;
const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();
const lastTouched = new Map<string, number>();

// ---------- certificate ----------

// ---------- addresses ----------

// ---------- status ----------

export function remoteStatus(): RemoteStatus {
  const s = store.getSettings();
  const running = !!server;
  const fp = fingerprint();
  const hosts = running ? candidateHosts() : [];
  const name = serverName();
  let offer: RemoteStatus["pairing"] = null;
  if (running && pairing && pairing.expiresAt > Date.now()) {
    // Kept short so the QR code stays easy to scan; the Mac's name comes back from /pair.
    const q = new URLSearchParams({ v: "1", h: hosts.join(","), p: String(server!.port), fp, c: pairing.code });
    offer = { url: `kestrel://pair?${q}`, expiresAt: pairing.expiresAt };
  }
  return {
    enabled: s.remoteEnabled,
    running,
    port: s.remotePort,
    serverName: name,
    fingerprint: fp,
    hosts,
    error: listenError,
    pairing: offer,
    devices: store.listDevices().map((d) => ({ ...d, online: (sockets.get(d.id)?.size ?? 0) > 0 })),
    tailscale: tailscaleStatus(),
    stayAwake: sleepDisabled(),
  };
}

function broadcast() {
  emit({ type: "remote_status", status: remoteStatus() });
}

// ---------- auth ----------

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function authenticate(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(req.url).searchParams.get("token");
  if (!token) return null;
  const device = store.deviceByTokenHash(hashToken(token));
  if (!device) {
    log.warn("a request carried an unknown device token", { path: new URL(req.url).pathname });
    return null;
  }
  // last_seen is informational; don't write on every RPC.
  if (Date.now() - (lastTouched.get(device.id) ?? 0) > 60_000) {
    lastTouched.set(device.id, Date.now());
    store.touchDevice(device.id);
  }
  return device;
}

function sameCode(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function redeemPairing(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { code?: string; name?: string } | null;
  const offer = pairing;
  if (!offer || offer.expiresAt <= Date.now()) {
    log.warn("pairing attempted without a valid offer");
    return Response.json({ error: "pairing_expired" }, { status: 410 });
  }
  if (!body?.code || !sameCode(body.code, offer.code)) {
    // A pairing code is only shown in a QR code; repeated misses mean someone is guessing.
    log.warn("wrong pairing code", { failures: offer.failures + 1 });
    if (++offer.failures >= MAX_PAIR_ATTEMPTS) {
      log.error("too many wrong pairing codes, the offer was cancelled");
      cancelPairing();
    }
    return Response.json({ error: "pairing_invalid" }, { status: 403 });
  }
  cancelPairing(false);
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const name = (body.name ?? "").trim().slice(0, 80) || "iPhone";
  store.addDevice(id, name, hashToken(token));
  log.info("device paired", { deviceId: id, name });
  broadcast();
  return Response.json({ deviceId: id, token, serverName: serverName() });
}

// ---------- listener ----------

function track(ws: ServerWebSocket<SocketData>, open: boolean) {
  const id = ws.data.caller.deviceId!;
  const set = sockets.get(id) ?? new Set();
  if (open) set.add(ws);
  else set.delete(ws);
  log.debug(open ? "device connected" : "device disconnected", { deviceId: id, sockets: set.size });
  if (set.size) sockets.set(id, set);
  else sockets.delete(id);
  broadcast();
}

function start() {
  stop();
  const s = store.getSettings();
  try {
    const { cert, key } = ensureCertificate();
    server = Bun.serve<SocketData>({
      hostname: "0.0.0.0",
      port: s.remotePort,
      idleTimeout: 255,
      tls: { cert: Bun.file(cert), key: Bun.file(key) },
      async fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/pair" && req.method === "POST") return redeemPairing(req);
        const device = authenticate(req);
        if (!device) return new Response("unauthorized", { status: 401 });
        return handleApi(req, srv, { remote: true, deviceId: device.id });
      },
      websocket: {
        ...socketHandlers,
        open(ws) {
          socketHandlers.open!(ws);
          track(ws, true);
        },
        close(ws, code, reason) {
          socketHandlers.close!(ws, code, reason);
          track(ws, false);
        },
      },
    });
    listenError = null;
    log.info("listening for phones", { port: s.remotePort });
  } catch (e: any) {
    server = null;
    listenError = e?.code === "EADDRINUSE" ? `port ${s.remotePort} is already in use` : (e?.message ?? String(e));
    log.error("could not listen for phones", { port: s.remotePort, error: e });
  }
}

function stop() {
  cancelPairing(false);
  for (const set of sockets.values()) for (const ws of set) ws.close(1001, "remote access disabled");
  sockets.clear();
  server?.stop(true);
  server = null;
}

function cancelPairing(notify = true) {
  pairing = null;
  if (pairingTimer) clearTimeout(pairingTimer);
  pairingTimer = null;
  if (notify) broadcast();
}

function dropDevice(id: string) {
  log.info("device removed", { deviceId: id });
  store.deleteDevice(id);
  for (const ws of sockets.get(id) ?? []) ws.close(4401, "device revoked");
  sockets.delete(id);
}

export function initRemote(dir: string) {
  dataDir = dir;
  if (store.getSettings().remoteEnabled) start();
}

export function shutdownRemote() {
  stop();
}

registerHandlers({
  "remote.status": () => remoteStatus(),
  "remote.configure": ({ enabled, port }: { enabled?: boolean; port?: number }) => {
    const patch: { remoteEnabled?: boolean; remotePort?: number } = {};
    if (enabled !== undefined) patch.remoteEnabled = enabled;
    if (port !== undefined) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be between 1024 and 65535");
      patch.remotePort = port;
    }
    const next = store.saveSettings(patch);
    log.info("remote access configured", { enabled: next.remoteEnabled, port: next.remotePort });
    if (next.remoteEnabled) start();
    else stop();
    broadcast();
    return remoteStatus();
  },
  "remote.pairingStart": () => {
    if (!server) throw new Error("remote access is not running");
    cancelPairing(false);
    log.info("pairing offer created", { ttlMs: PAIRING_TTL_MS });
    pairing = { code: randomBytes(16).toString("base64url"), expiresAt: Date.now() + PAIRING_TTL_MS, failures: 0 };
    pairingTimer = setTimeout(() => cancelPairing(), PAIRING_TTL_MS);
    broadcast();
    return remoteStatus();
  },
  "remote.pairingCancel": () => {
    cancelPairing();
    return remoteStatus();
  },
  "remote.revoke": ({ id }: { id: string }) => {
    dropDevice(id);
    broadcast();
    return remoteStatus();
  },
  // A paired phone refreshes where it can reach this Mac (e.g. Tailscale set up after pairing).
  "device.hosts": () => ({ hosts: server ? candidateHosts() : [] }),
  "remote.tailscaleInstall": () => {
    spawnSync("open", [DOWNLOAD_URL]);
    return true;
  },
  "remote.tailscaleOpen": () => {
    openTailscaleApp();
    return remoteStatus();
  },
  "remote.tailscaleConnect": async () => {
    const { authUrl } = await tailscaleConnect();
    if (authUrl) spawnSync("open", [authUrl]);
    return { authUrl, status: remoteStatus() };
  },
  "remote.stayAwake": async ({ on }: { on: boolean }) => {
    try {
      await setSleepDisabled(on);
    } catch (e: any) {
      if (e.message !== "cancelled") throw e;
    }
    broadcast();
    return remoteStatus();
  },
  // Called by a phone that is forgetting this Mac, so it disappears from the device list too.
  "device.unpair": (_params, caller: Caller) => {
    if (!caller.deviceId) throw new Error("only a paired device can unpair itself");
    dropDevice(caller.deviceId);
    broadcast();
    return true;
  },
  "remote.resetCertificate": () => {
    log.warn("certificate reset, every paired device must pair again");
    // A new certificate breaks every existing pin, so paired devices go with it.
    for (const d of store.listDevices()) dropDevice(d.id);
    fs.rmSync(certPaths().dir, { recursive: true, force: true });
    if (store.getSettings().remoteEnabled) start();
    broadcast();
    return remoteStatus();
  },
});
