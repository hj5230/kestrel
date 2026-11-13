// Image conversion with the Mac's own ffmpeg, for formats the composer's webview cannot decode (HEIC in a
// non-Apple webview, TIFF, AVIF on older WebKit). Output matches what every vision API accepts: JPEG, at most
// 2048px on the long edge and under 3.75 MB (Anthropic's 5 MB per-image limit once base64-encoded).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome, which } from "./env";
import * as store from "./db";
import { st } from "./i18n";
import { logger } from "./log";

const log = logger("media");

const MAX_BYTES = 3.75 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const FALLBACKS = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];

function executable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The configured ffmpeg, or the one found on PATH or in Homebrew's usual places. */
export function ffmpegPath(): string | null {
  const configured = store.getSettings().ffmpegPath.trim();
  if (configured) return executable(expandHome(configured)) ? expandHome(configured) : null;
  return which("ffmpeg") ?? FALLBACKS.find(executable) ?? null;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function mediaStatus(): Promise<{ path: string | null; configured: boolean; version: string | null }> {
  const bin = ffmpegPath();
  const configured = !!store.getSettings().ffmpegPath.trim();
  if (!bin) return { path: null, configured, version: null };
  try {
    const r = await run(bin, ["-hide_banner", "-version"], 5000);
    return { path: bin, configured, version: /ffmpeg version (\S+)/.exec(r.stdout)?.[1] ?? null };
  } catch (e) {
    log.warn("ffmpeg did not answer", { bin, error: e });
    return { path: null, configured, version: null };
  }
}

/** Decodes any image ffmpeg can read and returns a JPEG a vision API accepts. */
export async function convertImage(data: string, name = "image"): Promise<{ data: string; mimeType: string }> {
  const bin = ffmpegPath();
  if (!bin) throw new Error(st("ffmpegMissing"));
  const input = Buffer.from(String(data ?? ""), "base64");
  if (!input.length) throw new Error(st("imageUnreadable"));
  if (input.length > MAX_SOURCE_BYTES) throw new Error(st("imageTooLarge"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-media-"));
  try {
    // Only the extension is kept from the name: ffmpeg picks some demuxers by it, and the rest stays out of argv.
    const ext = (path.extname(String(name)).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) ?? [".img"])[0];
    const src = path.join(dir, `in${ext}`);
    const flat = path.join(dir, "flat.png");
    const out = path.join(dir, "out.jpg");
    fs.writeFileSync(src, input);
    // Decode first, to a lossless frame. iPhone HEIC photos are tile grids that ffmpeg assembles with its own
    // filter graph, which can't be combined with a scale filter in the same run.
    const quiet = ["-hide_banner", "-loglevel", "error", "-y"];
    const decoded = await run(bin, [...quiet, "-i", src, "-frames:v", "1", "-update", "1", "-c:v", "png", "-f", "image2", flat], 60_000);
    if (decoded.code !== 0 || !fs.existsSync(flat)) throw new Error(st("imageUnreadable"));
    for (const [edge, q] of [[2048, 3], [2048, 6], [1568, 6], [1024, 8]] as const) {
      const scale = `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`;
      const r = await run(bin, [...quiet, "-i", flat, "-frames:v", "1", "-vf", scale, "-c:v", "mjpeg", "-q:v", String(q), "-update", "1", "-f", "image2", out], 60_000);
      if (r.code !== 0 || !fs.existsSync(out)) throw new Error(st("imageUnreadable"));
      const bytes = fs.readFileSync(out);
      if (bytes.length <= MAX_BYTES) return { data: bytes.toString("base64"), mimeType: "image/jpeg" };
    }
    throw new Error(st("imageTooLarge"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
