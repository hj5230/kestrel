// The session list. Rows stay quiet: status sits where the menu button does, and a group label folds its sessions away.
// The parts are in sidebar/; this holds what is folded and which dialog is open.
import { useEffect, useMemo, useState } from "preact/hooks"
import type { SessionInfo } from "@shared/protocol"
import { Sidebar, SidebarContent, useSidebar } from "@/components/ui/sidebar"
import { useEdgeSwipe } from "@/hooks/use-edge-swipe"
import { RenameDialog, ConfirmDeleteDialog, ArchivedDialog, MergeDialog } from "@/components/session-dialogs"
import { appInfo, route, sessions } from "@/lib/store"
import { lang, t } from "@/lib/i18n"
import { SidebarStatus } from "./sidebar/footer"
import { GroupingMenu } from "./sidebar/grouping-menu"
import { SidebarNav } from "./sidebar/nav"
import { COLLAPSED_KEY, FOLDED_KEY, loadCollapsed, loadGroupMode, saveGroupMode, storeCollapsed, type GroupMode } from "./sidebar/prefs"
import { SessionGroupView, type SessionActions } from "./sidebar/session-group"
import { buildTree, groupSessions } from "./sidebar/session-tree"

export { StatusDot } from "./sidebar/session-item"

/** A set of ids remembered on this device, toggled one at a time. */
function useToggleSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => loadCollapsed(key))
  const toggle = (id: string) =>
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      storeCollapsed(next, key)
      return next
    })
  return [set, toggle] as const
}

export function AppSidebar() {
  const [groupMode, setGroupMode] = useState<GroupMode>(loadGroupMode)
  const [collapsed, toggleGroup] = useToggleSet(COLLAPSED_KEY)
  const [folded, toggleFold] = useToggleSet(FOLDED_KEY)
  const [renaming, setRenaming] = useState<SessionInfo | null>(null)
  const [deleting, setDeleting] = useState<SessionInfo | null>(null)
  const [merging, setMerging] = useState<{ source: SessionInfo; target: SessionInfo | null } | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const r = route.value
  const activeId = r.name === "chat" ? r.sessionId : null
  const { setOpenMobile, openMobile, isMobile } = useSidebar()
  useEdgeSwipe(isMobile, openMobile, setOpenMobile)
  // On phones the sidebar is a drawer over the page: get out of the way once something is picked.
  useEffect(() => setOpenMobile(false), [JSON.stringify(r)])
  const list = sessions.value

  const tree = useMemo(() => buildTree(list), [list])
  const groups = useMemo(() => groupSessions(tree.top, groupMode, appInfo.value?.home), [tree, groupMode, lang.value])

  const setMode = (m: GroupMode) => {
    setGroupMode(m)
    saveGroupMode(m)
  }
  const actions: SessionActions = {
    rename: setRenaming,
    remove: setDeleting,
    merge: (source, target) => setMerging({ source, target }),
  }

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarNav />
      <SidebarContent className="gap-0">
        {list.length === 0 && <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t("sidebar.empty")}</div>}
        {groups.map((g, i) => (
          <SessionGroupView
            key={g.id}
            group={g}
            first={i === 0}
            open={!collapsed.has(g.id)}
            onToggle={() => toggleGroup(g.id)}
            tree={tree}
            folded={folded}
            onToggleFold={toggleFold}
            activeId={activeId}
            actions={actions}
            labelEnd={i === 0 && <GroupingMenu mode={groupMode} onMode={setMode} onArchived={() => setArchivedOpen(true)} />}
          />
        ))}
      </SidebarContent>
      <SidebarStatus />
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDeleteDialog session={deleting} onClose={() => setDeleting(null)} />
      <MergeDialog source={merging?.source ?? null} target={merging?.target} onClose={() => setMerging(null)} />
      <ArchivedDialog open={archivedOpen} onOpenChange={setArchivedOpen} />
    </Sidebar>
  )
}
