// Self-update end to end against a local mirror: a signed release in pieces is found, downloaded,
// checked and unpacked; a release signed with another key, a damaged piece or an older version is not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./db";
import { CHUNK_BYTES, packRelease } from "./update/pack";
import { compareVersions, verifyManifest } from "./update/release";
import { checkForUpdate, initUpdater } from "./update/updater";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-update-"));
const repo = path.join(root, "repo");
const keys = generateKeyPairSync("ed25519");
const pubkey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
let server: ReturnType<typeof Bun.serve>;

/** A stand-in app bundle with a given version and enough random bytes to need several pieces. */
function fakeApp(version: string): string {
  const app = path.join(root, `build-${version}`, "Kestrel.app");
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`);
  fs.writeFileSync(path.join(app, "Contents", "MacOS", "kestrel"), crypto.getRandomValues(new Uint8Array(CHUNK_BYTES + 4096)));
  const zip = path.join(root, `Kestrel-${version}.zip`);
  expect(spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, zip]).status).toBe(0);
  return zip;
}

function publish(version: string, key = pem) {
  packRelease({ version, notes: `Notes for ${version}`, page: `https://example.test/${version}`, macZip: fakeApp(version), privateKeyPem: key, out: path.join(repo, `v${version}`) });
  fs.mkdirSync(path.join(repo, "main"), { recursive: true });
  fs.writeFileSync(path.join(repo, "main", "latest.json"), JSON.stringify({ beta: version, stable: null }));
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: (req) => {
    const file = path.join(repo, decodeURIComponent(new URL(req.url).pathname));
    return file.startsWith(repo) && fs.existsSync(file) ? new Response(Bun.file(file)) : new Response("missing", { status: 404 });
  } });
  process.env.KESTREL_RELEASE_BASE = `http://127.0.0.1:${server.port}`;
  process.env.KESTREL_RELEASE_PUBKEY = pubkey;
  store.openDb(path.join(root, "data"), true);
  store.saveSettings({ proxyMode: "none" });
  initUpdater({ dataDir: path.join(root, "data"), version: "0.1.0-beta.5", dev: false });
});

afterAll(() => {
  server.stop(true);
  delete process.env.KESTREL_RELEASE_BASE;
  delete process.env.KESTREL_RELEASE_PUBKEY;
});

test("versions order with pre-releases", () => {
  expect(compareVersions("0.1.0-beta.10", "0.1.0-beta.9")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0", "0.1.0-beta.9")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0-beta.5", "0.1.0-beta.5")).toBe(0);
  expect(compareVersions("0.2.0-beta.1", "0.1.9")).toBeGreaterThan(0);
});

test("a newer signed release is downloaded in pieces, verified and unpacked", async () => {
  publish("0.1.0-beta.6");
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, "v0.1.0-beta.6", "manifest.json"), "utf8"));
  expect(manifest.mac.chunks.length).toBeGreaterThan(1);
  const s = await checkForUpdate();
  expect(s.error).toBeNull();
  expect(s.state).toBe("ready");
  expect(s.latest?.version).toBe("0.1.0-beta.6");
  expect(fs.existsSync(path.join(s.stagedPath!, "Contents", "Info.plist"))).toBe(true);
}, 60000);

test("a release signed with another key is refused", async () => {
  const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publish("0.1.0-beta.7", other);
  const s = await checkForUpdate();
  expect(s.state).toBe("error");
  expect(s.error).toContain("signature");
  const bytes = fs.readFileSync(path.join(repo, "v0.1.0-beta.7", "manifest.json"));
  expect(verifyManifest(bytes, fs.readFileSync(path.join(repo, "v0.1.0-beta.7", "manifest.sig"), "utf8"), pubkey)).toBe(false);
}, 60000);

test("a damaged piece is refused", async () => {
  publish("0.1.0-beta.8");
  const piece = path.join(repo, "v0.1.0-beta.8", "mac", "Kestrel-0.1.0-beta.8.zip.001");
  const data = fs.readFileSync(piece);
  data[0] ^= 0xff;
  fs.writeFileSync(piece, data);
  const s = await checkForUpdate();
  expect(s.state).toBe("error");
  expect(s.error).toContain("damaged");
}, 60000);

test("nothing newer means up to date", async () => {
  fs.writeFileSync(path.join(repo, "main", "latest.json"), JSON.stringify({ beta: "0.1.0-beta.4", stable: null }));
  const s = await checkForUpdate();
  expect(s.state).toBe("idle");
  expect(s.latest).toBeNull();
});
