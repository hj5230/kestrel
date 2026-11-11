// Lays out one release for the releases repository: files cut into pieces jsDelivr will serve, and the
// manifest naming each piece's hash, signed with the release key. Used by scripts/release.ts and tests.
import { createPrivateKey, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChunkedFile, ReleaseManifest } from "../../shared/protocol";
import { sha256 } from "./release";

/** jsDelivr refuses files over 20 MB from GitHub; stay well under it. */
export const CHUNK_BYTES = 15 * 1024 * 1024;

function chunked(file: string, folder: string, out: string): ChunkedFile {
  const data = fs.readFileSync(file);
  const name = path.basename(file);
  fs.mkdirSync(path.join(out, folder), { recursive: true });
  const chunks: ChunkedFile["chunks"] = [];
  for (let at = 0, i = 0; at < data.length; at += CHUNK_BYTES, i++) {
    const piece = data.subarray(at, at + CHUNK_BYTES);
    const rel = `${folder}/${name}.${String(i).padStart(3, "0")}`;
    fs.writeFileSync(path.join(out, rel), piece);
    chunks.push({ path: rel, size: piece.length, sha256: sha256(piece) });
  }
  return { name, size: data.length, sha256: sha256(data), chunks };
}

export function packRelease(opts: {
  version: string;
  notes: string;
  page: string;
  macZip: string;
  ipa?: { path: string; build: number };
  privateKeyPem: string;
  out: string;
}): ReleaseManifest {
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });
  const manifest: ReleaseManifest = {
    version: opts.version,
    date: new Date().toISOString(),
    notes: opts.notes,
    mac: chunked(opts.macZip, "mac", opts.out),
    ...(opts.ipa ? { ios: { ...chunked(opts.ipa.path, "ios", opts.out), build: opts.ipa.build } } : {}),
    page: opts.page,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(opts.out, "manifest.json"), bytes);
  fs.writeFileSync(path.join(opts.out, "manifest.sig"), sign(null, bytes, createPrivateKey(opts.privateKeyPem)).toString("base64") + "\n");
  return manifest;
}
