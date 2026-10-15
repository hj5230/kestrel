import { toast } from "sonner"
import { isTauri, rpc } from "./api"
import { t } from "./i18n"

export async function downloadText(filename: string, content: string) {
  const safe = filename.replace(/[\\/:*?"<>|]/g, "_")
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const path = await save({ defaultPath: safe })
    if (!path) return
    await rpc("fs.writeText", { path, content })
    toast.success(t("notify.exported"), { description: path })
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = safe
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const res = await open({ directory: true, multiple: false, defaultPath })
  return typeof res === "string" ? res : null
}
