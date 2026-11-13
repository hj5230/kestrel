// The app's state as signals: route, sessions and their transcripts, settings, providers and models, and the
// phone's paired Macs. boot() loads it; server events (store/events.ts) keep it current.
import { computed, signal, type Signal } from "@preact/signals"
import type { AppInfo, AppSettings, McpServerStatus, ModelConfig, ProviderConfig, RemoteStatus, SessionDetail, SessionInfo } from "@shared/protocol"
import { connectEvents, disconnectEvents, rpc } from "./api"
import { setLang } from "./i18n"
import { connectionGeneration } from "./connection-generation"
import { getPairedMac, listMacs, type PairedMac } from "./pairing"
import { isMobileApp } from "./platform"
import { handleEvents } from "./store/events"
import { logger, setLogVerbosity } from "./log"
export { adoptPairedMac, switchMac, forgetPairedMac, unpairMac } from "./store/macs"

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
let routeHost = ""
const routeKey = () => isMobileApp && routeHost ? `kestrel-route:${routeHost}` : "kestrel-route"

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
    routeStore().setItem(routeKey(), JSON.stringify(r))
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
/** Mobile: every paired Mac, for switching between them. */
export const pairedMacs = signal<PairedMac[]>([])
/** Mobile: the pairing screen is open to add another Mac while one is already in use. */
export const addingMac = signal(false)
/** Mobile: the Mac removed this phone; it has to pair again. */
export const deviceRevoked = signal(false)
export const newSessionOpen = signal(false)

// Sessions whose run finished while the user was elsewhere: the sidebar keeps a dot until they are opened.
// Kept per Mac on the phone, since two Macs can share session ids by chance only, never by meaning.
const unseenKey = () => (isMobileApp && routeHost ? `kestrel-unseen:${routeHost}` : "kestrel-unseen")
function loadUnseen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(unseenKey()) ?? "[]")
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}
export const unseen = signal<Set<string>>(new Set())
export function setUnseen(next: Set<string>) {
  unseen.value = next
  try {
    localStorage.setItem(unseenKey(), JSON.stringify([...next]))
  } catch {}
}
export function markSeen(id: string) {
  if (!unseen.value.has(id)) return
  const next = new Set(unseen.value)
  next.delete(id)
  setUnseen(next)
}
route.subscribe((r) => {
  if (r.name === "chat") markSeen(r.sessionId)
})

export const details = new Map<string, Signal<DetailState | null>>()

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

export function patchDetail(id: string, fn: (d: DetailState) => DetailState) {
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
  if ("logLevel" in patch) setLogVerbosity(settings.value.logLevel)
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

export function upsertSession(s: SessionInfo) {
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

export async function boot() {
  const generation = connectionGeneration.capture()
  handleEvents()
  bootError.value = null
  try {
    if (isMobileApp) {
      const [active, all] = await Promise.all([getPairedMac(), listMacs().catch(() => null)])
      if (!connectionGeneration.current(generation)) return
      pairedMac.value = active
      pairedMacs.value = all?.macs ?? (active ? [active] : [])
      if (!pairedMac.value) return
      routeHost = pairedMac.value.fingerprint
      try {
        const saved = localStorage.getItem(routeKey())
        route.value = saved ? JSON.parse(saved) : { name: "home" }
      } catch { route.value = { name: "home" } }
    }
    unseen.value = loadUnseen()
    const [info, s] = await Promise.all([rpc<AppInfo>("app.info"), rpc<AppSettings>("settings.get")])
    if (!connectionGeneration.current(generation)) return
    appInfo.value = info
    settings.value = s
    setLogVerbosity(s.logLevel)
    logger("boot").info("loaded", { version: info.version, dev: info.dev, platform: info.platform })
    setLang(s.language)
    applyTheme()
    await Promise.all([refreshSessions(), refreshProviders()])
    const r = route.value
    if (r.name === "chat" && !sessions.value.some((x) => x.id === r.sessionId)) {
      await rpc("sessions.get", { id: r.sessionId }).catch(() => (route.value = { name: "home" }))
    }
    if (connectionGeneration.current(generation)) connectEvents()
  } catch (e: any) {
    if (!connectionGeneration.current(generation)) return
    const msg = e?.message ?? String(e)
    logger("boot").error("start-up failed", { error: e })
    if (isMobileApp && msg === "unauthorized") deviceRevoked.value = true
    else bootError.value = msg
  }
}

/** Forget everything shown for the previous Mac; the next one loads from scratch. */
export function resetForMacChange() {
  disconnectEvents()
  connected.value = false
  settings.value = null
  sessions.value = []
  providers.value = []
  models.value = []
  mcpServers.value = []
  appInfo.value = null
  remoteStatus.value = null
  paletteOpen.value = false
  details.clear()
  routeHost = ""
  unseen.value = new Set()
  pairedMac.value = undefined
  route.value = { name: "home" }
  deviceRevoked.value = false
  bootError.value = null
}

/** Host-local drafts must never appear on another paired Mac. */
export function draftKeyForHost(key: string) {
  return isMobileApp ? `${pairedMac.value?.fingerprint ?? "unpaired"}:${key}` : key
}
