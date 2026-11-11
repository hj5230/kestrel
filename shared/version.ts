// Version order for updates, shared by the sidecar (which release is newer) and the phone (is its app behind).

/** Semantic versions, pre-release included: 0.1.0-beta.2 < 0.1.0-beta.10 < 0.1.0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, "").split("-", 2);
    return { core: core.split(".").map((n) => Number(n) || 0), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) - (y.core[i] ?? 0);
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const np = /^\d+$/.test(p);
    const nq = /^\d+$/.test(q);
    if (np && nq && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (np !== nq) return np ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Where a version's files can be downloaded by hand. */
export const releasePage = (version: string) => `https://github.com/hj5230/kestrel/releases/tag/v${version}`;
