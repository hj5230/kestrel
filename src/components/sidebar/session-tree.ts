// The session list's shape: forks under the session they came from, and the top-level sessions grouped by day
// or by folder, pinned ones first.
import type { SessionInfo } from "@shared/protocol"
import { basename, dayBucket, dayBucketId, shortPath } from "@/lib/format"
import { t } from "@/lib/i18n"
import type { GroupMode } from "./prefs"

export interface SessionTree {
  top: SessionInfo[]
  /** Forks by the top-level session they descend from, oldest first. */
  children: Map<string, SessionInfo[]>
  byId: Map<string, SessionInfo>
}

export interface SessionGroup {
  id: string
  label: string
  /** The full name when the label is shortened (a folder's path). */
  title: string
  items: SessionInfo[]
}

/** A fork of a fork goes under the same top-level session; one whose source is gone stands on its own again. */
export function buildTree(list: SessionInfo[]): SessionTree {
  const byId = new Map(list.map((s) => [s.id, s]))
  const children = new Map<string, SessionInfo[]>()
  const rootOf = (s: SessionInfo) => {
    let cur = s
    const seen = new Set([s.id])
    while (cur.forkOf && byId.has(cur.forkOf) && !seen.has(cur.forkOf)) {
      cur = byId.get(cur.forkOf)!
      seen.add(cur.id)
    }
    return cur
  }
  const top: SessionInfo[] = []
  for (const s of list) {
    const root = rootOf(s)
    if (root === s) top.push(s)
    else children.set(root.id, [...(children.get(root.id) ?? []), s])
  }
  for (const kids of children.values()) kids.sort((a, b) => a.createdAt - b.createdAt)
  return { top, children, byId }
}

export function groupSessions(top: SessionInfo[], mode: GroupMode, home?: string): SessionGroup[] {
  const out: SessionGroup[] = []
  const pinned = top.filter((s) => s.pinned)
  if (pinned.length) {
    const label = t("sidebar.pinned")
    out.push({ id: "pinned", label, title: label, items: pinned })
  }
  const map = new Map<string, SessionGroup>()
  for (const s of top) {
    if (s.pinned) continue
    const id = mode === "time" ? `time:${dayBucketId(s.updatedAt)}` : `project:${s.cwd}`
    let group = map.get(id)
    if (!group) {
      const label = mode === "time" ? dayBucket(s.updatedAt) : basename(s.cwd)
      group = { id, label, title: mode === "time" ? label : shortPath(s.cwd, home), items: [] }
      map.set(id, group)
      out.push(group)
    }
    group.items.push(s)
  }
  return out
}
