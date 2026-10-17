// Remote access for the mobile app.
//
// A second listener on the LAN, separate from the loopback one the desktop window uses. It serves
// the same API over TLS with a self-signed certificate whose SHA-256 the phone pins (learned from
// the pairing QR code), so no CA or domain is needed and nobody on the network can impersonate the
// Mac. Phones authenticate with a per-device token obtained once by redeeming a short-lived,
// single-use pairing code; tokens are stored hashed and can be revoked individually.
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server, ServerWebSocket } from "bun";
import type { RemoteStatus } from "../shared/protocol";
import * as store from "./db";
import { which } from "./env";
import { emit } from "./hub";
import { handleApi, registerHandlers, socketHandlers, type Caller, type SocketData } from "./server";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_PAIR_ATTEMPTS = 5;

let dataDir = "";
let server: Server<SocketData> | null = null;
let listenError: string | null = null;
let pairing: { code: string; expiresAt: number; failures: number } | null = null;
let pairingTimer: ReturnType<typeof setTimeout> | null = null;
const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();
const lastTouched = new Map<string, number>();

// ---------- certificate ----------

function certPaths() {
  const dir = path.join(dataDir, "remote");
  return { dir, cert: path.join(dir, "cert.pem"), key: path.join(dir, "key.pem") };
}

function ensureCertificate() {
  const p = certPaths();
  if (fs.existsSync(p.cert) && fs.existsSync(p.key)) return p;
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  // PKCS#8 from node:crypto: Bun's TLS stack rejects the SEC1 EC keys LibreSSL writes.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.writeFileSync(p.key, privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  // Extensions make it an X.509 v3 certificate; without them LibreSSL writes v1, which rustls
  // (webpki) on the phone refuses to parse. A config file rather than -addext, which older
  // LibreSSL builds lack.
  const conf = path.join(p.dir, "openssl.cnf");
  fs.writeFileSync(
    conf,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3",
      "prompt = no",
      "[dn]",
      "CN = Kestrel",
      "[v3]",
      "basicConstraints = critical, CA:FALSE",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = DNS:kestrel.local",
      "",
    ].join("\n"),
  );
  const r = spawnSync(
    "/usr/bin/openssl",
    ["req", "-x509", "-new", "-sha256", "-key", p.key, "-out", p.cert, "-days", "3650", "-config", conf],
    { encoding: "utf8" },
  );
  fs.rmSync(conf, { force: true });
  if (r.status !== 0) {
    fs.rmSync(p.key, { force: true });
    throw new Error(`certificate generation failed: ${(r.stderr || r.error?.message || "").trim()}`);
  }
  return p;
}

function fingerprint(): string {
  const { cert } = certPaths();
  if (!fs.existsSync(cert)) return "";
  return new X509Certificate(fs.readFileSync(cert)).fingerprint256.replace(/:/g, "").toLowerCase();
}

// ---------- addresses ----------

const octets = (ip: string) => ip.split(".").map(Number);
const isTailscale = (ip: string) => {
  const [a, b] = octets(ip);
  return a === 100 && b >= 64 && b <= 127;
};
// 198.18.0.0/15 is what proxy apps (Clash, Surge…) put on their TUN interface; unreachable from a phone.
const isProxyTun = (ip: string) => {
  const [a, b] = octets(ip);
  return a === 198 && (b === 18 || b === 19);
};

let tailscaleName: { at: number; name: string | null } | null = null;

function tailscaleDnsName(): string | null {
  if (tailscaleName && Date.now() - tailscaleName.at < 60_000) return tailscaleName.name;
  let name: string | null = null;
  const bin = which("tailscale") ?? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale"].find((p) => fs.existsSync(p));
  if (bin) {
    const r = spawnSync(bin, ["status", "--json"], { encoding: "utf8", timeout: 2000 });
    try {
      name = String(JSON.parse(r.stdout).Self?.DNSName ?? "").replace(/\.$/, "") || null;
    } catch {}
  }
  tailscaleName = { at: Date.now(), name };
  return name;
}

/** Addresses the phone can try, most likely first: LAN IPs, then Tailscale, then names. */
function candidateHosts(): string[] {
  const lan: string[] = [];
  const tailnet: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.") || isProxyTun(a.address)) continue;
      (isTailscale(a.address) ? tailnet : lan).push(a.address);
    }
  }
  const names: string[] = [];
  const ts = tailnet.length ? tailscaleDnsName() : null;
  if (ts) names.push(ts);
  const host = os.hostname();
  if (host) names.push(host.endsWith(".local") ? host : `${host}.local`);
  return [...new Set([...lan, ...tailnet, ...names])];
}

let cachedName: { at: number; name: string } | null = null;

function serverName(): string {
  if (cachedName && Date.now() - cachedName.at < 60_000) return cachedName.name;
  let name = "";
  if (process.platform === "darwin") {
    name = spawnSync("scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 1000 }).stdout?.trim() ?? "";
  }
  name ||= os.hostname().replace(/\.local$/, "");
  cachedName = { at: Date.now(), name };
  return name;
}

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
  if (!device) return null;
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
  if (!offer || offer.expiresAt <= Date.now()) return Response.json({ error: "pairing_expired" }, { status: 410 });
  if (!body?.code || !sameCode(body.code, offer.code)) {
    // A pairing code is only shown in a QR code; repeated misses mean someone is guessing.
    if (++offer.failures >= MAX_PAIR_ATTEMPTS) cancelPairing();
    return Response.json({ error: "pairing_invalid" }, { status: 403 });
  }
  cancelPairing(false);
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const name = (body.name ?? "").trim().slice(0, 80) || "iPhone";
  store.addDevice(id, name, hashToken(token));
  broadcast();
  return Response.json({ deviceId: id, token, serverName: serverName() });
}

// ---------- listener ----------

function track(ws: ServerWebSocket<SocketData>, open: boolean) {
  const id = ws.data.caller.deviceId!;
  const set = sockets.get(id) ?? new Set();
  if (open) set.add(ws);
  else set.delete(ws);
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
  } catch (e: any) {
    server = null;
    listenError = e?.code === "EADDRINUSE" ? `port ${s.remotePort} is already in use` : (e?.message ?? String(e));
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
    if (next.remoteEnabled) start();
    else stop();
    broadcast();
    return remoteStatus();
  },
  "remote.pairingStart": () => {
    if (!server) throw new Error("remote access is not running");
    cancelPairing(false);
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
  // Called by a phone that is forgetting this Mac, so it disappears from the device list too.
  "device.unpair": (_params, caller: Caller) => {
    if (!caller.deviceId) throw new Error("only a paired device can unpair itself");
    dropDevice(caller.deviceId);
    broadcast();
    return true;
  },
  "remote.resetCertificate": () => {
    // A new certificate breaks every existing pin, so paired devices go with it.
    for (const d of store.listDevices()) dropDevice(d.id);
    fs.rmSync(certPaths().dir, { recursive: true, force: true });
    if (store.getSettings().remoteEnabled) start();
    broadcast();
    return remoteStatus();
  },
});
