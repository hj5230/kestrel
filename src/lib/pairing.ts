// Mobile only: pairing this phone with the Kestrel on a Mac. The native shell does the network
// work (pinned TLS) and keeps the device token in the Keychain; this module is the UI's handle.
import { invoke } from "@tauri-apps/api/core"
import { t, type MessageKey } from "./i18n"

export interface PairedMac {
  serverName: string
  hosts: string[]
  port: number
  fingerprint: string
  deviceId: string
  pairedAt: number
}

export function getPairedMac(): Promise<PairedMac | null> {
  return invoke<PairedMac | null>("remote_profile")
}

export function pairWithMac(link: string, deviceName: string): Promise<PairedMac> {
  // Pasted text may carry more than the link (a message it was sent in, a stray character).
  const found = /kestrel:\/\/pair\?[^\s"'<>]+/i.exec(link)
  return invoke<PairedMac>("remote_pair", { link: found ? found[0] : link.trim(), deviceName })
}

export function forgetMac(): Promise<void> {
  return invoke("remote_forget")
}

export function defaultDeviceName() {
  return /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? "iPad" : "iPhone"
}

/** Opens the camera; resolves with the QR payload, or null if the user backed out. */
export async function scanPairingCode(): Promise<string | null> {
  const scanner = await import("@tauri-apps/plugin-barcode-scanner")
  let perm = await scanner.checkPermissions()
  if (perm !== "granted") perm = await scanner.requestPermissions()
  if (perm !== "granted") throw new Error("camera_denied")
  try {
    const res = await scanner.scan({ formats: [scanner.Format.QRCode], windowed: false })
    return res.content || null
  } catch (e) {
    if (/cancel/i.test(String(e))) return null
    throw e
  }
}

const KNOWN: Record<string, MessageKey> = {
  unreachable: "pair.error.unreachable",
  pairing_expired: "pair.error.expired",
  pairing_invalid: "pair.error.invalid",
  invalid_link: "pair.error.link",
  camera_denied: "pair.error.camera",
  unauthorized: "pair.error.revoked",
}

const raw = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "")

/** Native errors arrive as short codes, sometimes followed by detail ("unreachable: …"). */
export function describePairingError(e: unknown): string {
  const msg = raw(e)
  const key = KNOWN[msg.split(":")[0].trim()]
  return key ? t(key) : msg
}

/** The technical part after the code, for troubleshooting; empty when there is none. */
export function pairingErrorDetail(e: unknown): string {
  const msg = raw(e)
  const i = msg.indexOf(":")
  return i > 0 && KNOWN[msg.slice(0, i).trim()] ? msg.slice(i + 1).trim() : ""
}
