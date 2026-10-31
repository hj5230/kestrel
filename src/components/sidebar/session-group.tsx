// One group of the list: its label, which folds the group, and its sessions with their forks under them.
import type { ComponentChildren } from "preact"
import { ChevronRightIcon } from "lucide-react"
import type { SessionInfo } from "@shared/protocol"
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { SessionItem } from "./session-item"
import type { SessionGroup, SessionTree } from "./session-tree"

export interface SessionActions {
  rename: (s: SessionInfo) => void
  remove: (s: SessionInfo) => void
  merge: (s: SessionInfo, target: SessionInfo | null) => void
}

export function SessionGroupView({
  group,
  first,
  open,
  onToggle,
  tree,
  folded,
  onToggleFold,
  activeId,
  actions,
  labelEnd,
}: {
  group: SessionGroup
  first: boolean
  open: boolean
  onToggle: () => void
  tree: SessionTree
  folded: Set<string>
  onToggleFold: (id: string) => void
  activeId: string | null
  actions: SessionActions
  /** Shown at the end of the label row (the grouping menu, on the first group). */
  labelEnd?: ComponentChildren
}) {
  const item = (s: SessionInfo, extra: Partial<Parameters<typeof SessionItem>[0]> = {}) => (
    <SessionItem
      key={s.id}
      s={s}
      active={s.id === activeId}
      parent={s.forkOf ? tree.byId.get(s.forkOf) : undefined}
      onRename={() => actions.rename(s)}
      onDelete={() => actions.remove(s)}
      onMerge={(target) => actions.merge(s, target)}
      {...extra}
    />
  )
  return (
    <SidebarGroup className={cn("px-2 pb-0.5", first ? "pt-2" : "pt-3")}>
      <div className="group/label flex items-center gap-0.5 pr-1">
        <button
          type="button"
          className="flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-normal text-muted-foreground outline-none hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-11"
          aria-expanded={open}
          title={group.title !== group.label ? group.title : undefined}
          onClick={onToggle}
        >
          <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
          <span className="truncate">{group.label}</span>
        </button>
        {labelEnd}
      </div>
      {open && (
        <SidebarGroupContent>
          <SidebarMenu className="gap-px">
            {group.items.flatMap((s) => {
              const kids = tree.children.get(s.id) ?? []
              if (!kids.length) return [item(s)]
              const isFolded = folded.has(s.id)
              return [
                item(s, { folded: isFolded, onToggleFold: () => onToggleFold(s.id) }),
                ...(isFolded ? [] : kids.map((k, j) => item(k, { branch: j === kids.length - 1 ? "last" : "middle" }))),
              ]
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}
