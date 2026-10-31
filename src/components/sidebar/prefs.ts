// How the list is grouped, and which groups and fork trees are folded, remembered on this device.
export type GroupMode = "time" | "project"

export function loadGroupMode(): GroupMode {
  try {
    return (localStorage.getItem("kestrel-group-mode") as GroupMode) || "time"
  } catch {
    return "time"
  }
}

export function saveGroupMode(mode: GroupMode) {
  try {
    localStorage.setItem("kestrel-group-mode", mode)
  } catch {}
}

export const COLLAPSED_KEY = "kestrel-collapsed-groups"
export const FOLDED_KEY = "kestrel-folded-forks"

export function loadCollapsed(key = COLLAPSED_KEY): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]")
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((x) => typeof x === "string"))
  } catch {
    return new Set()
  }
}

export function storeCollapsed(ids: Set<string>, key = COLLAPSED_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {}
}
