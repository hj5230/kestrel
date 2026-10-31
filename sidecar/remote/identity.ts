// How phones find and trust this Mac: its self-signed certificate and fingerprint, the addresses offered for
// pairing (LAN and Tailscale, never the proxy's fake IPs), and the name shown on the phone.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tailscaleStatus } from "../tailscale";
import { dataDir } from "../remote";

export function certPaths() {
  const dir = path.join(dataDir, "remote");
  return { dir, cert: path.join(dir, "cert.pem"), key: path.join(dir, "key.pem") };
}

export function ensureCertificate() {
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

export function fingerprint(): string {
  const { cert } = certPaths();
  if (!fs.existsSync(cert)) return "";
  return new X509Certificate(fs.readFileSync(cert)).fingerprint256.replace(/:/g, "").toLowerCase();
}

export const octets = (ip: string) => ip.split(".").map(Number);

export const isTailscale = (ip: string) => {
  const [a, b] = octets(ip);
  return a === 100 && b >= 64 && b <= 127;
};

// 198.18.0.0/15 is what proxy apps (Clash, Surge…) put on their TUN interface; unreachable from a phone.
export const isProxyTun = (ip: string) => {
  const [a, b] = octets(ip);
  return a === 198 && (b === 18 || b === 19);
};

/** Addresses the phone can try, most likely first: LAN IPs, then the tailnet, then names. */
export function candidateHosts(): string[] {
  const lan: string[] = [];
  const tailnet: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.") || isProxyTun(a.address)) continue;
      (isTailscale(a.address) ? tailnet : lan).push(a.address);
    }
  }
  const ts = tailscaleStatus();
  const names: string[] = [];
  if (ts.dnsName) names.push(ts.dnsName);
  const host = os.hostname();
  if (host) names.push(host.endsWith(".local") ? host : `${host}.local`);
  return [...new Set([...lan, ...ts.ips, ...tailnet, ...names])];
}

export let cachedName: { at: number; name: string } | null = null;

export function serverName(): string {
  if (cachedName && Date.now() - cachedName.at < 60_000) return cachedName.name;
  let name = "";
  if (process.platform === "darwin") {
    name = spawnSync("scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 1000 }).stdout?.trim() ?? "";
  }
  name ||= os.hostname().replace(/\.local$/, "");
  cachedName = { at: Date.now(), name };
  return name;
}
