// Reasoning effort values as each model names them. Shared so the picker and the sidecar agree on
// order and on when a stored preference applies; nothing is mapped to a "nearby" level.

/** Weakest to strongest. Values a model invents (or we have not ranked) sort after these, alphabetically. */
export const EFFORT_RANK = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** Preference shown in Settings. A session uses it only when the chosen model lists that exact value. */
export const PREFERRED_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function sortEfforts(values: string[]): string[] {
  const rank = new Map(EFFORT_RANK.map((v, i) => [v, i]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.sort((a, b) => (rank.get(a) ?? 100) - (rank.get(b) ?? 100) || a.localeCompare(b));
}

/**
 * The effort to send for this model.
 * Null means "do not send the field": the model has no effort list, or none of its values is the
 * one the user asked for and it publishes no default. The provider then uses its own default.
 */
export function resolveThinking(stored: string | null | undefined, efforts: string[] | null | undefined, effortDefault?: string | null): string | null {
  if (!efforts || efforts.length === 0) return null;
  const want = stored === "off" ? "none" : stored;
  if (want && efforts.includes(want)) return want;
  if (effortDefault && efforts.includes(effortDefault)) return effortDefault;
  return null;
}
