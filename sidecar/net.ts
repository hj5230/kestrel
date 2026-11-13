// Every outgoing request of the sidecar goes through proxiedFetch: it applies the proxy setting and logs the call
// (host and path only, never the query string, which can carry keys).
import * as store from "./db";
import { getShellEnv } from "./env";
import { logger } from "./log";

const netLog = logger("net");
const SLOW_REQUEST_MS = 20_000;

/** Host and path only: query strings carry keys and tokens. */
function where(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname };
  } catch {
    return { host: "?", path: "?" };
  }
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

function noProxyMatch(host: string, noProxy: string) {
  return noProxy
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => rule === "*" || host === rule.replace(/^\./, "") || host.endsWith(rule.startsWith(".") ? rule : "." + rule));
}

export function proxyFor(url: string): string | undefined {
  const settings = store.getSettings();
  if (settings.proxyMode === "none") return undefined;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (isLocalHost(host)) return undefined;
  if (settings.proxyMode === "custom") return settings.proxyUrl || undefined;
  const env = getShellEnv();
  const noProxy = env.NO_PROXY || env.no_proxy || "";
  if (noProxy && noProxyMatch(host, noProxy)) return undefined;
  const isHttps = url.startsWith("https:");
  return (
    (isHttps ? env.HTTPS_PROXY || env.https_proxy : env.HTTP_PROXY || env.http_proxy) ||
    env.ALL_PROXY ||
    env.all_proxy ||
    undefined
  );
}

export const proxiedFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const proxy = proxyFor(url);
    const t0 = performance.now();
    const target = { ...where(url), method: init?.method ?? (input instanceof Request ? input.method : "GET"), proxied: !!proxy };
    return fetch(input as any, { ...(init as any), proxy } as any).then(
      (res) => {
        const ms = Math.round(performance.now() - t0);
        const f = { ...target, status: res.status, ms };
        if (res.status >= 500 || res.status === 429) netLog.warn("request got an error status", f);
        else if (res.status >= 400) netLog.info("request refused", f);
        else if (ms > SLOW_REQUEST_MS) netLog.warn("slow request", f);
        else netLog.debug("request", f);
        return res;
      },
      (e) => {
        // A caller that aborts on purpose (stop, a timeout it set) is not a network fault.
        const aborted = e?.name === "AbortError" || e?.name === "TimeoutError";
        netLog[aborted ? "debug" : "warn"]("request failed", { ...target, ms: Math.round(performance.now() - t0), error: e });
        throw e;
      },
    );
  },
  { preconnect: fetch.preconnect },
) as typeof fetch;
