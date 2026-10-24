// File attachment upload helpers.
//
// Remote phones upload files into the app data directory under per-session folders. Paths and names
// are validated here so API handlers and lifecycle code can share one constrained implementation.
import fs from "node:fs";
import path from "node:path";
import type { FileAttachment } from "../shared/protocol";
import { FILE_ATTACHMENT_MAX_BYTES } from "../shared/protocol";
import * as store from "./db";
import { st } from "./i18n";

const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

export class UploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function ensureSessionId(sessionId: string): string {
  const id = String(sessionId ?? "").trim();
  if (!SESSION_ID_RE.test(id)) throw new UploadError(st("uploadInvalidSession"), 400);
  if (!store.getSession(id)) throw new UploadError(st("sessionNotFound"), 404);
  return id;
}

function splitName(name: string): { stem: string; ext: string } {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return { stem, ext };
}

function shortenName(name: string, max = 180): string {
  if (name.length <= max) return name;
  const { stem, ext } = splitName(name);
  const keepExt = ext.slice(0, 24);
  const keepStem = Math.max(1, max - keepExt.length);
  return `${stem.slice(0, keepStem)}${keepExt}`;
}

export function sanitizeUploadName(name: string): string {
  const base = path.basename(String(name ?? "").replace(CONTROL_CHARS_RE, "").trim()).replace(CONTROL_CHARS_RE, "");
  const cleaned = shortenName(base.replace(/\s+/g, " "));
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned;
}

export function uploadRoot(dataDir: string): string {
  return path.resolve(dataDir, "uploads");
}

export function sessionUploadDir(dataDir: string, sessionId: string): string {
  const root = uploadRoot(dataDir);
  const id = ensureSessionId(sessionId);
  const dir = path.resolve(root, id);
  if (!inside(dir, root)) throw new UploadError(st("uploadInvalidSession"), 400);
  return dir;
}

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** The session's folder, created only after checking it really lives inside the uploads root.
 *  A symlink at the root or at the folder would otherwise send the write somewhere else. */
function prepareUploadDir(dataDir: string, sessionId: string): string {
  const root = uploadRoot(dataDir);
  const dir = sessionUploadDir(dataDir, sessionId);
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new UploadError(st("uploadInvalidSession"), 400);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new UploadError(st("uploadInvalidSession"), 400);
  if (!inside(fs.realpathSync(dir), fs.realpathSync(root))) throw new UploadError(st("uploadInvalidSession"), 400);
  return dir;
}

/** Removes one session's uploads. Anything that isn't a plain session id is ignored, and a symlink is
 *  removed as a link: its target is never deleted. */
export function removeSessionUploads(dataDir: string, id: string) {
  if (!SESSION_ID_RE.test(String(id ?? ""))) return;
  const root = uploadRoot(dataDir);
  const dir = path.resolve(root, id);
  if (!inside(dir, root)) return;
  let info: fs.Stats;
  try {
    info = fs.lstatSync(dir);
  } catch {
    return;
  }
  if (info.isSymbolicLink()) {
    fs.unlinkSync(dir);
    return;
  }
  if (info.isDirectory()) fs.rmSync(dir, { recursive: true, force: true });
}

function inferMimeType(fileName: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(fileName).toLowerCase();
  const byExt: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return byExt[ext] ?? fallback;
}

function uniquePath(dir: string, fileName: string): { filePath: string; fileName: string } {
  const { stem, ext } = splitName(fileName);
  for (let i = 0; i < 10000; i++) {
    const candidate = i === 0 ? `${stem}${ext}` : `${stem}-${i}${ext}`;
    const filePath = path.join(dir, candidate);
    if (!fs.existsSync(filePath)) return { filePath, fileName: candidate };
  }
  throw new UploadError(st("uploadNameExhausted"), 409);
}

async function writeLimited(stream: ReadableStream<Uint8Array>, filePath: string, maxBytes: number): Promise<number> {
  // "wx" creates the file and refuses to follow a symlink at the final path.
  const file = await fs.promises.open(filePath, "wx");
  const reader = stream.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new UploadError(st("uploadTooLarge"), 413);
      await file.write(value);
    }
    return total;
  } finally {
    await file.close();
    // cancel stops the producer and releases the lock. releaseLock would throw while the stream still has data
    // and hide the size error.
    try {
      await reader.cancel();
    } catch {}
  }
}

export async function storeUpload(params: {
  dataDir: string;
  sessionId: string;
  fileName: string;
  mimeType?: string;
  stream: ReadableStream<Uint8Array> | null;
  sizeHint?: number;
}): Promise<FileAttachment> {
  if (!params.stream) throw new UploadError(st("uploadMissingFile"), 400);
  if (params.sizeHint && params.sizeHint > FILE_ATTACHMENT_MAX_BYTES) throw new UploadError(st("uploadTooLarge"), 413);
  const dir = prepareUploadDir(params.dataDir, params.sessionId);
  const sanitized = sanitizeUploadName(params.fileName);
  const target = uniquePath(dir, sanitized);
  let size = 0;
  try {
    size = await writeLimited(params.stream, target.filePath, FILE_ATTACHMENT_MAX_BYTES);
  } catch (e) {
    fs.rmSync(target.filePath, { force: true });
    throw e;
  }
  return {
    path: target.filePath,
    name: target.fileName,
    mimeType: inferMimeType(target.fileName, params.mimeType || "application/octet-stream"),
    size,
  };
}

export function describeLocalFiles(paths: string[]): FileAttachment[] {
  return paths.map((p) => {
    const abs = path.resolve(String(p));
    if (!path.isAbsolute(abs)) throw new UploadError(st("uploadInvalidPath"), 400);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new UploadError(st("uploadNotFile"), 400);
    const name = path.basename(abs);
    return {
      path: abs,
      name,
      mimeType: inferMimeType(name),
      size: stat.size,
    };
  });
}
