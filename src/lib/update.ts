// Update state shown in the app: the Mac's own update (downloaded by the sidecar) and, on the phone,
// whether this phone's app is behind the newest release. Installing is a Tauri command on the Mac.
import { computed, signal } from "@preact/signals"
import type { UpdateStatus } from "@shared/protocol"
import { compareVersions, releasePage } from "@shared/version"
import { rpc } from "./api"
import { isDesktopApp, isMobileApp } from "./platform"
import { sessions } from "./store"

export const updateStatus = signal<UpdateStatus | null>(null)

export async function loadUpdateStatus() {
  try {
    updateStatus.value = await rpc<UpdateStatus>("update.status")
  } catch {}
}

export const checkForUpdate = async () => (updateStatus.value = await rpc<UpdateStatus>("update.check"))

/** The Mac has a newer version unpacked and ready to swap in. */
export const updateReady = computed(() => isDesktopApp && updateStatus.value?.state === "ready" && !!updateStatus.value.stagedPath)

/** A session is mid-run: restarting now would cut it off. */
export const restartBlocked = computed(() => sessions.value.some((s) => s.status === "running" || s.status === "waiting"))

/** On the phone: a newer release than this phone's app, and where to get it. The Mac knows the newest
 *  release it has seen, or at least its own version, which is never older than what was published for it. */
export const phoneUpdate = computed(() => {
  const s = updateStatus.value
  if (!isMobileApp || !s) return null
  const newest = s.latest?.version ?? s.current
  if (compareVersions(newest, __APP_VERSION__) <= 0) return null
  return { version: newest, page: s.latest?.page ?? releasePage(newest) }
})

export async function installUpdate() {
  const staged = updateStatus.value?.stagedPath
  if (!staged) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("install_update", { staged })
}
