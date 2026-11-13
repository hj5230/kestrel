// Keeps secrets and bulk out of log records. Anything that can reach a log line passes through here: messages are
// scrubbed for key shapes, and structured fields are flattened to plain JSON with secret-looking keys removed.

const KEYED = /("?(?:api[-_]?key|apikey|token|secret|password|passwd|authorization|cookie|x-kestrel-token|access[-_]?token|refresh[-_]?token|client[-_]?secret)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const KEY_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})\b/g;
const URL_QUERY = /([?&](?:token|key|api_key|apikey|access_token|code|secret|sig|signature)=)[^&\s"']+/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
/** A field name that holds a credential. Anchored at the end so `tokens` and `inputTokens` (counts) are not caught. */
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|credentials?|private[-_]?key)$/i;

export const MAX_STRING = 4000;
const MAX_KEYS = 40;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;

export function scrub(s: string, max = MAX_STRING): string {
  let out = s
    .replace(URL_USERINFO, "$1[redacted]@")
    .replace(URL_QUERY, "$1[redacted]")
    .replace(BEARER, "$1 [redacted]")
    .replace(KEYED, "$1[redacted]")
    .replace(KEY_SHAPES, "[redacted]");
  if (out.length > max) out = `${out.slice(0, max)}…(+${out.length - max} chars)`;
  return out;
}

function errorFields(e: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const stack = (e.stack ?? "").split("\n").slice(0, 12).join("\n");
  const out: Record<string, unknown> = { name: e.name, message: scrub(e.message), stack: scrub(stack) };
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (e.cause !== undefined) out.cause = plain(e.cause, depth + 1, seen);
  return out;
}

/** Any value as plain, bounded, secret-free JSON. */
export function plain(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (v === null || v === undefined || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "string") return scrub(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function" || typeof v === "symbol") return `[${typeof v}]`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "[invalid date]" : v.toISOString();
  if (typeof v !== "object") return String(v);
  if (seen.has(v)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[deep]";
  seen.add(v);
  if (v instanceof Error) return errorFields(v, depth, seen);
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ITEMS).map((x) => plain(x, depth + 1, seen));
    if (v.length > MAX_ITEMS) items.push(`…(+${v.length - MAX_ITEMS} items)`);
    return items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  for (const [k, val] of entries.slice(0, MAX_KEYS)) {
    out[k] = SECRET_KEY.test(k) && typeof val !== "boolean" && typeof val !== "number" ? "[redacted]" : plain(val, depth + 1, seen);
  }
  if (entries.length > MAX_KEYS) out["…"] = `+${entries.length - MAX_KEYS} keys`;
  return out;
}

export function plainFields(fields: Record<string, unknown>): Record<string, unknown> {
  return plain(fields) as Record<string, unknown>;
}
