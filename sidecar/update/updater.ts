// Finds, downloads and unpacks a newer Kestrel in the background. The app shell swaps it in on restart;
// nothing here touches the installed app. Downloads resume chunk by chunk, so a lost connection only
// costs the piece that was in flight.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ReleaseManifest, UpdateStatus } from "../../shared/protocol";
import * as store from "../db";
import { emit } from "../hub";
import { logger } from "../log";
import { compareVersions, fetchManifest, fetchPointer, fetchRelease, sha256, tagOf } from "./release";

const log = logger("update");
const EVERY_MS = 6 * 60 * 60 * 1000;
let dir = "";
let status: UpdateStatus = { current: "0.0.0", state: "idle", latest: null, progress: null, error: null, checkedAt: null, stagedPath: null };
let running: Promise<UpdateStatus> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

const set = (patch: Partial<UpdateStatus>) => {
  status = { ...status, ...patch };
  emit({ type: "update_status", status });
};

export const updateStatus = () => status;

/** Development builds and builds run from outside an app bundle have nothing to replace. */
export function initUpdater(opts: { dataDir: string; version: string; dev: boolean }) {
  dir = path.join(opts.dataDir, "updates");
  status = { ...status, current: opts.version, state: opts.dev ? "disabled" : "idle" };
  log.info("updater ready", { current: opts.version, enabled: !opts.dev, channel: store.getSettings().updateChannel, auto: store.getSettings().updateAutoCheck });
  if (opts.dev) return;
  const tick = () => {
    if (store.getSettings().updateAutoCheck) void checkForUpdate().catch((e) => log.warn("scheduled check failed", e));
  };
  setTimeout(tick, 30_000).unref();
  timer = setInterval(tick, EVERY_MS);
  timer.unref();
}

export function stopUpdater() {
  if (timer) clearInterval(timer);
}

/** Checks now. While a check or download is already running, joins it instead of starting another. */
export function checkForUpdate(): Promise<UpdateStatus> {
  if (status.state === "disabled") return Promise.resolve(status);
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<UpdateStatus> {
  set({ state: "checking", error: null });
  const t0 = Date.now();
  try {
    const pointer = await fetchPointer();
    const channel = store.getSettings().updateChannel;
    log.info("checked for updates", { current: status.current, channel, beta: pointer.beta, stable: pointer.stable, ms: Date.now() - t0 });
    const candidates = [pointer.stable, channel === "beta" ? pointer.beta : null].filter((v): v is string => !!v);
    const target = candidates.sort(compareVersions).pop();
    if (!target || compareVersions(target, status.current) <= 0) {
      set({ state: "idle", latest: null, progress: null, checkedAt: Date.now(), stagedPath: null });
      return status;
    }
    log.info("new version found", { current: status.current, target });
    const manifest = await fetchManifest(target);
    set({
      latest: { version: manifest.version, date: manifest.date, notes: manifest.notes, page: manifest.page, ios: manifest.ios && { version: manifest.version, size: manifest.ios.size } },
      checkedAt: Date.now(),
    });
    set({ state: "ready", stagedPath: await stage(manifest), progress: null });
    log.info("update ready to install", { version: manifest.version, ms: Date.now() - t0 });
  } catch (e: any) {
    log.error("update failed", { current: status.current, error: e, ms: Date.now() - t0 });
    set({ state: "error", error: String(e?.message ?? e).slice(0, 300), progress: null, checkedAt: Date.now() });
  }
  return status;
}

/** Downloads the Mac app for a release, checks it and unpacks it; returns the unpacked bundle. */
async function stage(m: ReleaseManifest): Promise<string> {
  const base = path.join(dir, m.version);
  const app = path.join(base, "app", "Kestrel.app");
  const done = path.join(base, "staged.json");
  if (fs.existsSync(done) && fs.existsSync(app) && JSON.parse(fs.readFileSync(done, "utf8")).sha256 === m.mac.sha256) return app;
  // Older downloads are of no further use once a newer one is wanted.
  for (const old of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (old !== m.version) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  fs.mkdirSync(path.join(base, "chunks"), { recursive: true });

  const ref = tagOf(m.version);
  let doneBytes = 0;
  const parts: string[] = [];
  set({ state: "downloading", progress: { done: 0, total: m.mac.size } });
  for (const chunk of m.mac.chunks) {
    const file = path.join(base, "chunks", path.basename(chunk.path));
    parts.push(file);
    const have = fs.existsSync(file) && fs.statSync(file).size === chunk.size && sha256(fs.readFileSync(file)) === chunk.sha256;
    if (!have) {
      const data = await fetchRelease(ref, chunk.path, undefined, 5 * 60_000);
      log.debug("chunk downloaded", { path: chunk.path, size: data.length });
      if (data.length !== chunk.size || sha256(data) !== chunk.sha256) log.error("downloaded chunk does not match its hash", { path: chunk.path, expected: chunk.size, got: data.length });
      if (data.length !== chunk.size || sha256(data) !== chunk.sha256) throw new Error(`${chunk.path} is damaged; it will be downloaded again`);
      fs.writeFileSync(file, data);
    }
    doneBytes += chunk.size;
    set({ progress: { done: doneBytes, total: m.mac.size } });
  }

  const zip = path.join(base, m.mac.name);
  fs.writeFileSync(zip, Buffer.concat(parts.map((p) => fs.readFileSync(p))));
  if (sha256(fs.readFileSync(zip)) !== m.mac.sha256) throw new Error("the downloaded app does not match the release");
  fs.rmSync(path.join(base, "app"), { recursive: true, force: true });
  const unzip = spawnSync("/usr/bin/ditto", ["-x", "-k", zip, path.join(base, "app")], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error(`could not unpack the update: ${unzip.stderr.trim()}`);
  const plist = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" });
  if (plist.stdout.trim() !== m.version) throw new Error("the unpacked app reports a different version");
  fs.rmSync(zip, { force: true });
  fs.rmSync(path.join(base, "chunks"), { recursive: true, force: true });
  fs.writeFileSync(done, JSON.stringify({ version: m.version, sha256: m.mac.sha256 }));
  return app;
}
