import { toast } from "sonner"
import { rpc } from "./api"
import { t } from "./i18n"
import { isDesktopApp, isMobileApp } from "./platform"

export async function downloadText(filename: string, content: string) {
  const safe = filename.replace(/[\\/:*?"<>|]/g, "_")
  if (isDesktopApp) {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const path = await save({ defaultPath: safe })
    if (!path) return
    await rpc("fs.writeText", { path, content })
    toast.success(t("notify.exported"), { description: path })
    return
  }
  if (isMobileApp) {
    // The phone has no save dialog: hand the file to the share sheet (Save to Files, AirDrop…).
    const file = new File([content], safe, { type: "text/markdown" })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error(String(e))
      }
      return
    }
    await navigator.clipboard.writeText(content)
    toast.success(t("notify.exportCopied"))
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = safe
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Native folder picker; desktop only (on the phone the folders live on the Mac). */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!isDesktopApp) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const res = await open({ directory: true, multiple: false, defaultPath })
  return typeof res === "string" ? res : null
}
