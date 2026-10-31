// The header's two menus: the session's "…" menu and the working-folder menu.
import { toast } from "sonner"
import { ArchiveIcon, ClipboardCopyIcon, EyeIcon, FolderInputIcon, FolderOpenIcon, GitBranchIcon, GitMergeIcon, PencilIcon, SplitIcon, ShrinkIcon, Trash2Icon } from "lucide-react"
import type { SessionInfo, TranscriptView } from "@shared/protocol"
import type { MenuNode } from "@/components/action-menu"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { isMobileApp } from "@/lib/platform"
import { appInfo, sessions, settings, updateSettings } from "@/lib/store"
import { t, type MessageKey } from "@/lib/i18n"
import { CwdBrowser } from "../pickers"
import { VIEWS } from "../view-picker"
import { copy, type SessionActions } from "./actions"

export function sessionMenu(
  s: SessionInfo,
  opts: { running: boolean; lastSeq: number; actions: SessionActions; rename: () => void; remove: () => void; merge: (target: SessionInfo | null) => void },
): MenuNode[] {
  const { running, actions } = opts
  const forkSource = s.forkOf ? sessions.value.find((x) => x.id === s.forkOf) : undefined
  return [
    { kind: "item", label: t("common.rename"), icon: PencilIcon, onSelect: opts.rename },
    { kind: "item", label: t("chat.compact"), icon: ShrinkIcon, onSelect: () => actions.compact(), disabled: running },
    { kind: "item", label: t("chat.fork"), icon: GitBranchIcon, onSelect: () => actions.fork(opts.lastSeq) },
    {
      kind: "radio",
      label: t("view.label"),
      icon: EyeIcon,
      value: settings.value?.transcriptView ?? "compact",
      options: VIEWS.map((v) => ({ value: v.value, label: t(`view.${v.value}` as MessageKey), desc: t(`view.${v.value}.desc` as MessageKey) })),
      onChange: (v) => updateSettings({ transcriptView: v as TranscriptView }).catch((e) => toast.error(e.message)),
    },
    {
      kind: "sub",
      label: t("chat.copyTranscript"),
      icon: ClipboardCopyIcon,
      children: [
        { kind: "item", label: t("chat.copyMarkdown"), onSelect: () => rpc<string>("sessions.export", { id: s.id }).then(copy, (e) => toast.error(e.message)) },
        { kind: "item", label: t("chat.copyJsonl"), onSelect: () => rpc<string>("sessions.jsonl", { id: s.id }).then(copy, (e) => toast.error(e.message)) },
        // Kestrel keeps sessions as rows in its SQLite database, not one transcript file per session like
        // Claude Code's JSONL, so there is no path to copy. Kept visible and disabled until sessions are files.
        { kind: "item", label: t("chat.copySessionPath"), onSelect: () => {}, disabled: true },
      ],
    },
    ...(forkSource ? [{ kind: "item" as const, label: t("sidebar.mergeToMain"), icon: GitMergeIcon, onSelect: () => opts.merge(forkSource), disabled: running }] : []),
    ...(s.forkOf ? [{ kind: "item" as const, label: t("sidebar.detach"), icon: SplitIcon, onSelect: actions.detach }] : []),
    { kind: "item", label: t("sidebar.mergeInto"), icon: GitMergeIcon, onSelect: () => opts.merge(null), disabled: running },
    { kind: "item", label: t("sidebar.archive"), icon: ArchiveIcon, onSelect: actions.archive },
    { kind: "separator" },
    { kind: "item", label: t("chat.delete"), icon: Trash2Icon, destructive: true, onSelect: opts.remove },
  ]
}

/** The folder can only change before the first message: after that the transcript refers to its files. The
 *  entry stays visible, disabled, so it's clear why it can't be used. */
export function folderMenu(s: SessionInfo, actions: SessionActions): MenuNode[] {
  const home = appInfo.value?.home
  return [
    {
      kind: "panel",
      label: t("chat.changeDir"),
      icon: FolderInputIcon,
      disabled: s.messageCount > 0,
      className: "w-[min(24rem,calc(100vw-1.5rem))]",
      render: (close) => <CwdBrowser value={shortPath(s.cwd, home)} onChange={(cwd) => actions.update({ cwd })} onDone={close} />,
    },
    // The folder lives on the Mac; a phone has no Finder to show it in.
    ...(isMobileApp ? [] : [{ kind: "item" as const, label: t("chat.openInFinder"), icon: FolderOpenIcon, onSelect: () => rpc("app.open", { path: s.cwd }) }]),
    {
      kind: "sub",
      label: t("chat.copyPath"),
      icon: ClipboardCopyIcon,
      children: [
        { kind: "item", label: t("chat.copyPathHome"), onSelect: () => copy(shortPath(s.cwd, home)) },
        { kind: "item", label: t("chat.copyPathRoot"), onSelect: () => copy(s.cwd) },
      ],
    },
  ]
}
