import { computed, signal, type Signal } from "@preact/signals"
import { toast } from "sonner"
import type {
  AppInfo,
  AppSettings,
  McpServerStatus,
  ModelConfig,
  ProviderConfig,
  RemoteStatus,
  SessionDetail,
  SessionInfo,
} from "@shared/protocol"
import { connectEvents, disconnectEvents, onConnection, onRevoked, onServerEvent, rpc } from "./api"
import { setLang, t } from "./i18n"
import { forgetMac, getPairedMac, onPairedMacChanged, type PairedMac } from "./pairing"
import { isMobileApp, isTauri } from "./platform"

export type Route =
  | { name: "home" }
  | { name: "chat"; sessionId: string }
  | { name: "usage" }
  | { name: "settings"; tab?: string }

export interface DetailState extends SessionDetail {
  compacting: boolean
}

// Desktop restores the route per window session; iOS kills backgrounded apps, so the phone keeps
// it across launches to come back where the user left off.
const routeStore = () => (isMobileApp ? localStorage : sessionStorage)

function initialRoute(): Route {
  try {
    const r = JSON.parse(routeStore().getItem("kestrel-route") ?? "null")
    if (r && typeof r.name === "string") return r
  } catch {}
  return { name: "home" }
}

export const route = signal<Route>(initialRoute())
route.subscribe((r) => {
  try {
    routeStore().setItem("kestrel-route", JSON.stringify(r))
  } catch {}
})
export const sessions = signal<SessionInfo[]>([])
export const appInfo = signal<AppInfo | null>(null)
export const settings = signal<AppSettings | null>(null)
export const providers = signal<ProviderConfig[]>([])
export const models = signal<ModelConfig[]>([])
export const mcpServers = signal<McpServerStatus[]>([])
/** Bumped whenever a memory note is added, changed or deleted, so the Memory settings reload. */
export const memoryRev = signal(0)
export const connected = signal(false)
export const bootError = signal<string | null>(null)
export const paletteOpen = signal(false)
/** Desktop: state of the LAN listener phones connect to (Settings → Mobile). */
export const remoteStatus = signal<RemoteStatus | null>(null)
/** Mobile: the Mac this phone controls; null = not paired yet, undefined = still loading. */
export const pairedMac = signal<PairedMac | null | undefined>(undefined)
/** Mobile: the Mac removed this phone; it has to pair again. */
export const deviceRevoked = signal(false)
export const newSessionOpen = signal(false)

const details = new Map<string, Signal<DetailState | null>>()

export function detailSignal(id: string): Signal<DetailState | null> {
  let s = details.get(id)
  if (!s) {
    s = signal<DetailState | null>(null)
    details.set(id, s)
  }
  return s
}

export async function loadDetail(id: string) {
  const d = await rpc<SessionDetail>("sessions.get", { id })
  const sig = detailSignal(id)
  sig.value = { ...d, compacting: sig.value?.compacting ?? false }
  return sig.value
}

function patchDetail(id: string, fn: (d: DetailState) => DetailState) {
  const sig = details.get(id)
  if (sig?.value) sig.value = fn(sig.value)
}

export const enabledModels = computed(() => {
  const enabledProviders = new Set(providers.value.filter((p) => p.enabled).map((p) => p.id))
  return models.value.filter((m) => m.enabled && enabledProviders.has(m.providerId))
})

export function findModel(providerId: string, modelId: string) {
  return models.value.find((m) => m.providerId === providerId && m.id === modelId)
}

export function providerName(id: string) {
  return providers.value.find((p) => p.id === id)?.name ?? id
}

export async function refreshSessions() {
  sessions.value = await rpc<SessionInfo[]>("sessions.list", {})
}

export async function refreshProviders() {
  const [p, m] = await Promise.all([rpc<ProviderConfig[]>("providers.list"), rpc<ModelConfig[]>("models.list")])
  providers.value = p
  models.value = m
}

export async function updateSettings(patch: Partial<AppSettings>) {
  settings.value = await rpc<AppSettings>("settings.update", patch)
  setLang(settings.value.language)
  applyTheme()
}

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null

export function applyTheme() {
  const s = settings.value
  const root = document.documentElement
  const theme = s?.theme ?? "system"
  const dark = theme === "dark" || (theme === "system" && !!media?.matches)
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
  if (s && s.accent !== "neutral") root.dataset.accent = s.accent
  else delete root.dataset.accent
  try {
    localStorage.setItem("kestrel-theme", JSON.stringify({ dark, accent: s?.accent ?? "neutral" }))
  } catch {}
}

media?.addEventListener("change", applyTheme)

export function openSession(id: string) {
  route.value = { name: "chat", sessionId: id }
}

export async function createSession(input: Partial<SessionInfo> = {}) {
  const s = await rpc<SessionInfo>("sessions.create", input)
  upsertSession(s)
  openSession(s.id)
  return s
}

function upsertSession(s: SessionInfo) {
  if (s.kind !== "main") return
  const list = sessions.value.filter((x) => x.id !== s.id)
  if (s.archived) {
    sessions.value = list
    return
  }
  list.push(s)
  list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  sessions.value = list
}

async function notify(title: string, body: string) {
  if (!isTauri || document.hasFocus()) return
  try {
    const n = await import("@tauri-apps/plugin-notification")
    let granted = await n.isPermissionGranted()
    if (!granted) granted = (await n.requestPermission()) === "granted"
    if (granted) n.sendNotification({ title, body })
  } catch {}
}

let eventsWired = false

function handleEvents() {
  if (eventsWired) return
  eventsWired = true
  onRevoked(() => {
    deviceRevoked.value = true
  })
  if (isMobileApp) {
    void onPairedMacChanged((mac) => {
      if (pairedMac.value?.deviceId === mac.deviceId) pairedMac.value = mac
    })
  }
  onConnection((c) => {
    const was = connected.value
    connected.value = c
    if (c && !was) {
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
        notify(t("notify.approval"), e.request.kind === "bash" ? e.request.detail.slice(0, 120) : e.request.path ?? e.request.toolName)
        break
      case "approval_resolved":
        patchDetail(e.sessionId, (d) => ({ ...d, approvals: d.approvals.filter((a) => a.id !== e.id) }))
        break
      case "compaction":
        patchDetail(e.sessionId, (d) => ({ ...d, compactions: [...d.compactions, e.compaction] }))
        break
      case "compacting":
        patchDetail(e.sessionId, (d) => ({ ...d, compacting: e.active }))
        break
      case "mcp_status":
        mcpServers.value = e.servers
        break
      case "memory_changed":
        memoryRev.value++
        break
      case "notice":
        if (e.level === "error") toast.error(e.text)
        else if (e.level === "warn") toast.warning(e.text)
        else toast.info(e.text)
        break
      case "run_finished":
        if (settings.value?.notifyOnFinish) notify(e.ok ? t("notify.done") : t("notify.failed"), e.title)
        break
      case "remote_status":
        remoteStatus.value = e.status
        break
    }
  })
}

export async function boot() {
  handleEvents()
  bootError.value = null
  try {
    if (isMobileApp) {
      pairedMac.value = await getPairedMac()
      if (!pairedMac.value) return
    }
    const [info, s] = await Promise.all([rpc<AppInfo>("app.info"), rpc<AppSettings>("settings.get")])
    appInfo.value = info
    settings.value = s
    setLang(s.language)
    applyTheme()
    await Promise.all([refreshSessions(), refreshProviders()])
    const r = route.value
    if (r.name === "chat" && !sessions.value.some((x) => x.id === r.sessionId)) {
      await rpc("sessions.get", { id: r.sessionId }).catch(() => (route.value = { name: "home" }))
    }
    connectEvents()
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    if (isMobileApp && msg === "unauthorized") deviceRevoked.value = true
    else bootError.value = msg
  }
}

/** Mobile: start using a freshly paired Mac. */
export function adoptPairedMac(mac: PairedMac) {
  disconnectEvents()
  pairedMac.value = mac
  deviceRevoked.value = false
  settings.value = null
  void boot()
}

/** Mobile: drop the pairing and go back to the pairing screen. */
export async function unpairMac() {
  disconnectEvents()
  await forgetMac().catch(() => {})
  settings.value = null
  sessions.value = []
  details.clear()
  route.value = { name: "home" }
  deviceRevoked.value = false
  pairedMac.value = null
}
