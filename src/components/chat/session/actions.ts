// What can be done to the open session from its header, its menus and slash commands.
import { toast } from "sonner"
import type { SessionInfo } from "@shared/protocol"
import { rpc } from "@/lib/api"
import { createSession, enabledModels, openSession, route } from "@/lib/store"
import { t } from "@/lib/i18n"

export function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(t("common.copied")),
    (e) => toast.error(String(e?.message ?? e)),
  )
}

export function sessionActions(s: SessionInfo, lastSeq: number) {
  const update = (patch: Partial<SessionInfo>) => rpc("sessions.update", { id: s.id, patch }).catch((e) => toast.error(e.message))
  const fork = async (seq: number) => {
    const n = await rpc<SessionInfo>("sessions.fork", { id: s.id, seq })
    openSession(n.id)
    toast.success(t("chat.forked"))
  }
  const compact = (instructions?: string) =>
    rpc("chat.compact", { sessionId: s.id, instructions }).then(
      () => toast.success(t("chat.compacted")),
      (e) => toast.error(e.message),
    )
  const archive = async () => {
    await rpc("sessions.update", { id: s.id, patch: { archived: true } }).catch((e) => toast.error(e.message))
    route.value = { name: "home" }
    toast.success(t("sidebar.archivedToast"))
  }
  const exportMd = async () => (await import("@/lib/download")).downloadText(`${s.title || "session"}.md`, await rpc<string>("sessions.export", { id: s.id }))

  /** Slash commands the app handles itself instead of sending them to the agent. */
  const builtin = (name: string, args: string) => {
    switch (name) {
      case "compact":
        compact(args || undefined)
        return true
      case "clear":
        createSession({ cwd: s.cwd, providerId: s.providerId, modelId: s.modelId, thinking: s.thinking, permissionMode: s.permissionMode })
        return true
      case "export":
        exportMd()
        return true
      case "fork":
        fork(lastSeq)
        return true
      case "model": {
        const q = args.trim().toLowerCase()
        const m = q ? enabledModels.value.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase().includes(q)) : null
        if (m) {
          update({ providerId: m.providerId, modelId: m.id })
          toast.success(t("chat.switchedModel", { name: m.name }))
        } else toast.info(q ? t("chat.modelNotFound", { q: args }) : t("chat.modelUsage"))
        return true
      }
    }
    return false
  }

  return { update, fork, compact, archive, builtin }
}

export type SessionActions = ReturnType<typeof sessionActions>
