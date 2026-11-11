// Self-update. Each release is published to a public releases repository and fetched through jsDelivr;
// the manifest is signed, and every file in it is checked against its SHA-256 before use.

export type UpdateChannel = "beta" | "stable";

/** The pointer on the releases repository's main branch: the newest version on each channel. */
export interface ReleasePointer {
  beta: string | null;
  stable: string | null;
}

/** A file served in pieces: jsDelivr refuses single files over 20 MB. */
export interface ChunkedFile {
  name: string;
  size: number;
  sha256: string;
  chunks: { path: string; size: number; sha256: string }[];
}

/** What one release contains. Signed as a whole (manifest.sig, Ed25519 over the exact bytes). */
export interface ReleaseManifest {
  version: string;
  /** ISO date of publishing. */
  date: string;
  notes: string;
  mac: ChunkedFile;
  ios?: ChunkedFile & { build: number };
  /** The GitHub release page with the same files, for people downloading by hand. */
  page: string;
}

export interface UpdateStatus {
  current: string;
  /**
   * disabled — development build, nothing to update.
   * ready — the new app is downloaded, verified and unpacked; restarting installs it.
   */
  state: "idle" | "checking" | "downloading" | "ready" | "error" | "disabled";
  /** The newest release on the chosen channel, when it is newer than this one. */
  latest: { version: string; date: string; notes: string; page: string; ios?: { version: string; size: number } } | null;
  progress: { done: number; total: number } | null;
  error: string | null;
  checkedAt: number | null;
  /** The unpacked app the installer swaps in (desktop only). */
  stagedPath: string | null;
}
