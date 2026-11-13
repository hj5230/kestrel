// Where releases live and how they are trusted. Files come through jsDelivr (with GitHub as a fallback),
// so nothing fetched is trusted on its own: the manifest must carry a valid Ed25519 signature from the
// release key, and every chunk and file must match the SHA-256 the manifest gives for it.
import { createHash, createPublicKey, verify } from "node:crypto";
import type { ReleaseManifest, ReleasePointer } from "../../shared/protocol";
import { proxiedFetch } from "../providers";
import { logger } from "../log";
import { RELEASE_PUBLIC_KEY } from "./key";
import { compareVersions } from "../../shared/version";
export { compareVersions } from "../../shared/version";

const log = logger("update");
export const RELEASES_REPO = "hj5230/kestrel-releases";

/** Mirrors in order of preference. A tag is immutable, so any mirror serving it serves the same bytes. */
const PUBLIC_MIRRORS = [
  (ref: string, file: string) => `https://cdn.jsdelivr.net/gh/${RELEASES_REPO}@${ref}/${file}`,
  (ref: string, file: string) => `https://fastly.jsdelivr.net/gh/${RELEASES_REPO}@${ref}/${file}`,
  (ref: string, file: string) => `https://raw.githubusercontent.com/${RELEASES_REPO}/${ref}/${file}`,
];

// Tests serve a release from a local folder and sign it with their own key; both must be set together.
const local = () => (process.env.KESTREL_RELEASE_BASE && process.env.KESTREL_RELEASE_PUBKEY ? { base: process.env.KESTREL_RELEASE_BASE, key: process.env.KESTREL_RELEASE_PUBKEY } : null);
const mirrors = () => {
  const l = local();
  return l ? [(ref: string, file: string) => `${l.base}/${ref}/${file}`] : PUBLIC_MIRRORS;
};

export const tagOf = (version: string) => `v${version}`;

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** One file from the releases repository, trying each mirror in turn. */
export async function fetchRelease(ref: string, file: string, signal?: AbortSignal, timeoutMs = 60000): Promise<Uint8Array> {
  let last: unknown;
  for (const url of mirrors()) {
    try {
      const res = await proxiedFetch(url(ref, file), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) throw e;
      log.warn("mirror failed, trying the next", { file, mirror: new URL(url(ref, file)).host, error: e });
      last = e;
    }
  }
  throw new Error(`could not download ${file}: ${last instanceof Error ? last.message : String(last)}`);
}

/** The newest versions, from every mirror: a branch is cached for hours by the CDN, so take the newest answer. */
export async function fetchPointer(signal?: AbortSignal): Promise<ReleasePointer> {
  const answers = await Promise.allSettled(
    mirrors().map(async (url) => {
      const res = await proxiedFetch(url("main", "latest.json"), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ReleasePointer;
    }),
  );
  const ok = answers.flatMap((a) => (a.status === "fulfilled" ? [a.value] : []));
  if (!ok.length) throw new Error((answers[0] as PromiseRejectedResult).reason?.message ?? "no release information");
  const newest = (key: keyof ReleasePointer) =>
    ok.map((p) => (typeof p?.[key] === "string" ? (p[key] as string) : null)).filter((v): v is string => !!v).sort(compareVersions).pop() ?? null;
  return { beta: newest("beta"), stable: newest("stable") };
}

export function verifyManifest(bytes: Uint8Array, signatureBase64: string, key = local()?.key ?? RELEASE_PUBLIC_KEY): boolean {
  try {
    return verify(null, bytes, createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }), Buffer.from(signatureBase64.trim(), "base64"));
  } catch {
    return false;
  }
}

/** The signed manifest for a version; throws unless the signature and the version inside both check out. */
export async function fetchManifest(version: string, signal?: AbortSignal): Promise<ReleaseManifest> {
  const ref = tagOf(version);
  const [bytes, sig] = await Promise.all([fetchRelease(ref, "manifest.json", signal), fetchRelease(ref, "manifest.sig", signal)]);
  if (!verifyManifest(bytes, new TextDecoder().decode(sig))) log.error("release signature is not valid", { version });
  if (!verifyManifest(bytes, new TextDecoder().decode(sig))) throw new Error("the release signature is not valid");
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as ReleaseManifest;
  if (manifest.version !== version) throw new Error("the release does not match its version");
  return manifest;
}
