// Applying catalog facts to saved models: filling what was never set, and locking what the user changed.
import type { ModelConfig } from "../../shared/protocol";
import { CONTEXT_DEFAULT, MAX_DEFAULT, type CatalogFacts } from "../catalog";

export function sameCost(a: ModelConfig["cost"], b: NonNullable<CatalogFacts["cost"]>): boolean {
  return a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;
}

export function sameEfforts(current: string[] | null | undefined, incoming: string[]): boolean {
  if (current == null) return false;
  return current.length === incoming.length && current.every((value, i) => value === incoming[i]);
}

export function zeroCost(cost: ModelConfig["cost"]): boolean {
  return cost.input === 0 && cost.output === 0 && cost.cacheRead === 0 && cost.cacheWrite === 0;
}

/**
 * Fills fields that are still at the generic default. A field that already differs from both the
 * default and the catalog is locked, so a hand edit is not overwritten on the next refresh.
 * Returns null when nothing changes.
 */
export function planBackfill(model: ModelConfig, facts: CatalogFacts | null): ModelConfig | null {
  if (!facts) return null;
  const locked = new Set(model.locked ?? []);
  const next: ModelConfig = { ...model, cost: { ...model.cost }, locked: [...(model.locked ?? [])] };
  let changed = false;
  const take = (field: string, apply: () => void, equal: boolean, isDefault: boolean) => {
    if (locked.has(field) || equal) return;
    const previous = model.metadata?.values as Record<string, unknown> | undefined;
    const unchangedAutomatic = previous && Object.hasOwn(previous, field) && JSON.stringify(previous[field]) === JSON.stringify((model as any)[field]);
    if (!isDefault && !unchangedAutomatic) {
      locked.add(field);
      changed = true;
      return;
    }
    apply();
    changed = true;
  };
  if (facts.contextWindow) {
    take("contextWindow", () => (next.contextWindow = facts.contextWindow!), next.contextWindow === facts.contextWindow, model.contextWindow === CONTEXT_DEFAULT);
  }
  if (facts.maxTokens) {
    take("maxTokens", () => (next.maxTokens = facts.maxTokens!), next.maxTokens === facts.maxTokens, model.maxTokens === MAX_DEFAULT);
  }
  if (facts.cost) {
    take("cost", () => (next.cost = { ...facts.cost! }), sameCost(next.cost, facts.cost), zeroCost(model.cost));
  }
  take("efforts", () => (next.efforts = facts.efforts), sameEfforts(model.efforts, facts.efforts), model.efforts == null);
  if ((model.efforts == null || model.metadata?.values.effortDefault === model.effortDefault) && !locked.has("efforts") && !locked.has("effortDefault")) {
    const fallback = facts.effortDefault ?? null;
    if ((next.effortDefault ?? null) !== fallback) {
      next.effortDefault = fallback;
      changed = true;
    }
  }
  const untouched =
    model.efforts == null && model.contextWindow === CONTEXT_DEFAULT && model.maxTokens === MAX_DEFAULT && zeroCost(model.cost) && !(model.locked ?? []).length;
  if ((untouched || model.metadata?.values.reasoning === model.reasoning) && facts.reasoning != null && !locked.has("reasoning") && model.reasoning !== facts.reasoning) {
    next.reasoning = facts.reasoning;
    changed = true;
  }
  if ((untouched || model.metadata?.values.vision === model.vision) && facts.vision != null && !locked.has("vision") && model.vision !== facts.vision) {
    next.vision = facts.vision;
    changed = true;
  }
  const lockedList = [...locked];
  if (lockedList.join(",") !== (model.locked ?? []).join(",")) {
    next.locked = lockedList;
    changed = true;
  }
  const values = Object.fromEntries(["contextWindow", "maxTokens", "reasoning", "vision", "cost", "efforts", "effortDefault"].filter((key) => (facts as any)[key] != null).map((key) => [key, (facts as any)[key]]));
  if (!model.metadata || JSON.stringify(model.metadata.values) !== JSON.stringify(values)) {
    next.metadata = { source: model.metadataSource === "codex" ? "codex" : "catalog", checkedAt: Date.now(), values };
    changed = true;
  }
  return changed ? next : null;
}

/** Fields the user changed away from the catalog. A miss (no facts yet) leaves the locks alone. */
export function locksFor(model: ModelConfig, facts: CatalogFacts | null, previous?: ModelConfig | null): string[] {
  if (previous) {
    const locked = new Set(previous.locked ?? []);
    for (const key of ["contextWindow", "maxTokens", "reasoning", "vision", "cost", "efforts", "effortDefault"]) {
      if (JSON.stringify((model as any)[key]) !== JSON.stringify((previous as any)[key])) locked.add(key);
    }
    return [...locked];
  }
  if (!facts) return [...(model.locked ?? [])];
  const locked: string[] = [];
  if (facts.contextWindow && model.contextWindow !== facts.contextWindow) locked.push("contextWindow");
  if (facts.maxTokens && model.maxTokens !== facts.maxTokens) locked.push("maxTokens");
  if (facts.cost && !sameCost(model.cost, facts.cost)) locked.push("cost");
  if (facts.reasoning != null && model.reasoning !== facts.reasoning) locked.push("reasoning");
  if (facts.vision != null && model.vision !== facts.vision) locked.push("vision");
  // Null means the list was never set, not that the user cleared it.
  if (model.efforts != null && !sameEfforts(model.efforts, facts.efforts)) locked.push("efforts");
  return locked;
}
