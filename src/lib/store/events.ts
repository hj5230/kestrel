// Server events applied to the app's state: sessions, transcripts, runs, requests, and the cues and
// notifications that go with a finished, waiting or failed run.
import { toast } from "sonner"
import { onConnection, onRevoked, onServerEvent } from "../api"
import { t } from "../i18n"
import { onPairedMacChanged } from "../pairing"
import { isMobileApp, isTauri } from "../platform"
import { feedback } from "../feedback"
import { loadUpdateStatus, updateStatus } from "../update"
import { route, sessions, settings, mcpServers, memoryRev, connected, remoteStatus, pairedMac, pairedMacs, deviceRevoked, unseen, setUnseen, markSeen, details, loadDetail, patchDetail, refreshSessions, refreshProviders, upsertSession } from "../store"

export async function notify(title: string, body: string) {
  if (!isTauri || document.hasFocus()) return
  try {
    const n = await import("@tauri-apps/plugin-notification")
    let granted = await n.isPermissionGranted()
    if (!granted) granted = (await n.requestPermission()) === "granted"
    if (granted) n.sendNotification({ title, body })
  } catch {}
}

export let eventsWired = false

export function handleEvents() {
  if (eventsWired) return
  eventsWired = true
  onRevoked(() => {
    deviceRevoked.value = true
  })
  if (isMobileApp) {
    void onPairedMacChanged((mac) => {
      if (pairedMac.value?.deviceId === mac.deviceId) pairedMac.value = mac
      pairedMacs.value = pairedMacs.value.map((m) => (m.deviceId === mac.deviceId ? mac : m))
    })
  }
  onConnection((c) => {
    const was = connected.value
    connected.value = c
    if (c && !was) {
      void loadUpdateStatus()
      refreshSessions().catch(() => {})
      for (const [id, sig] of details) if (sig.value) loadDetail(id).catch(() => {})
    }
  })
  onServerEvent((e) => {
    switch (e.type) {
      case "session_updated":
        upsertSession(e.session)
        patchDetail(e.session.id, (d) => ({ ...d, session: e.session }))
        break
      case "session_deleted":
        markSeen(e.id)
        sessions.value = sessions.value.filter((s) => s.id !== e.id)
        details.delete(e.id)
        if (route.value.name === "chat" && route.value.sessionId === e.id) route.value = { name: "home" }
        break
      case "message_appended":
        patchDetail(e.sessionId, (d) =>
          d.messages.some((m) => m.seq === e.stored.seq) ? d : { ...d, messages: [...d.messages, e.stored] },
        )
        break
      case "messages_reset":
        if (details.get(e.sessionId)?.value) loadDetail(e.sessionId).catch(() => {})
        break
      case "stream":
        patchDetail(e.sessionId, (d) => ({ ...d, streaming: e.message }))
        break
      case "tool_start":
        patchDetail(e.sessionId, (d) => ({
          ...d,
          runningTools: { ...d.runningTools, [e.toolCallId]: { toolName: e.toolName, args: e.args, partial: null, startedAt: Date.now() } },
        }))
        break
      case "tool_update":
        patchDetail(e.sessionId, (d) => {
          const cur = d.runningTools[e.toolCallId]
          if (!cur) return d
          return { ...d, runningTools: { ...d.runningTools, [e.toolCallId]: { ...cur, partial: e.partial } } }
        })
        break
      case "tool_end":
        patchDetail(e.sessionId, (d) => {
          const next = { ...d.runningTools }
          delete next[e.toolCallId]
          return { ...d, runningTools: next }
        })
        break
      case "queue":
        patchDetail(e.sessionId, (d) => ({ ...d, queued: e.queued }))
        break
      case "approval_request":
        patchDetail(e.request.sessionId, (d) => ({ ...d, approvals: [...d.approvals.filter((a) => a.id !== e.request.id), e.request] }))
        feedback("input")
        notify(t("notify.approval"), e.request.kind === "bash" ? e.request.detail.slice(0, 120) : e.request.path ?? e.request.toolName)
        break
      case "approval_resolved":
        patchDetail(e.sessionId, (d) => ({ ...d, approvals: d.approvals.filter((a) => a.id !== e.id) }))
        break
      case "question_request":
        patchDetail(e.request.sessionId, (d) => ({ ...d, questions: [...d.questions.filter((q) => q.id !== e.request.id), e.request] }))
        feedback("input")
        notify(t("notify.question"), e.request.questions[0]?.prompt.slice(0, 120) ?? "")
        break
      case "question_resolved":
        patchDetail(e.sessionId, (d) => ({ ...d, questions: d.questions.filter((q) => q.id !== e.id) }))
        break
      case "compaction":
        patchDetail(e.sessionId, (d) => ({ ...d, compactions: [...d.compactions, e.compaction] }))
        break
      case "compacting":
        patchDetail(e.sessionId, (d) => ({ ...d, compacting: e.active }))
        break
      case "phase":
        patchDetail(e.sessionId, (d) => ({ ...d, phase: e.phase }))
        break
      case "mcp_status":
        mcpServers.value = e.servers
        break
      case "memory_changed":
        memoryRev.value++
        break
      case "models_updated":
        void refreshProviders()
        break
      case "notice":
        if (e.level === "error") toast.error(e.text)
        else if (e.level === "warn") toast.warning(e.text)
        else toast.info(e.text)
        break
      case "run_finished":
        if (!(route.value.name === "chat" && route.value.sessionId === e.sessionId && document.visibilityState === "visible")) {
          setUnseen(new Set(unseen.value).add(e.sessionId))
        }
        feedback(e.ok ? "done" : "error")
        if (settings.value?.notifyOnFinish) notify(e.ok ? t("notify.done") : t("notify.failed"), e.title)
        break
      case "remote_status":
        remoteStatus.value = e.status
        break
      case "update_status":
        updateStatus.value = e.status
        break
    }
  })
}
