// Mobile: the paired Macs, and moving between them without pairing again.
import { toast } from "sonner"
import { forgetMac, selectMac, type PairedMac } from "../pairing"
import { pairedMac, pairedMacs, addingMac, deviceRevoked, boot, resetForMacChange } from "../store"
import { logger } from "../log"

/** Mobile: start using a freshly paired Mac. */
export function adoptPairedMac(mac: PairedMac) {
  resetForMacChange()
  pairedMac.value = mac
  addingMac.value = false
  pairedMacs.value = [...pairedMacs.value.filter((m) => m.deviceId !== mac.deviceId), mac]
  void boot()
}

/** Mobile: move to another paired Mac without pairing again. */
export let switching = false

export async function switchMac(deviceId: string) {
  if (switching) return
  if (deviceId === pairedMac.value?.deviceId && !deviceRevoked.value) {
    addingMac.value = false
    return
  }
  try {
    switching = true
    const previous = pairedMac.value
    resetForMacChange()
    let mac: PairedMac
    try { mac = await selectMac(deviceId) } catch (e) { pairedMac.value = previous; void boot(); throw e }
    pairedMac.value = mac
    addingMac.value = false
    void boot()
  } catch (e: any) {
    logger("pairing").warn("switching Mac failed", { error: e })
    toast.error(String(e?.message ?? e))
  } finally { switching = false }
}

/** Mobile: forget one paired Mac. If it was the one in use, the phone moves to another, or to the pairing screen. */
export async function forgetPairedMac(deviceId: string) {
  const wasActive = pairedMac.value?.deviceId === deviceId
  const left = await forgetMac(deviceId).catch((e) => (logger("pairing").warn("forgetting a Mac failed", { error: e }), null))
  if (!left) return
  pairedMacs.value = left.macs
  if (!wasActive) return
  resetForMacChange()
  pairedMac.value = left.macs.find((m) => m.deviceId === left.active) ?? null
  if (pairedMac.value) void boot()
}

/** Mobile: forget the Mac in use. */
export async function unpairMac() {
  const id = pairedMac.value?.deviceId
  if (id) await forgetPairedMac(id)
}
