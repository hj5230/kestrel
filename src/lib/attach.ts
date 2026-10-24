import { isTauri } from "./platform"

/**
 * The system document picker, for files that are not images. Images deliberately do not come through
 * here: they must reach the model as pixels, and the webview's own image input is what offers
 * "Take Photo" and the photo library on iOS.
 * Returns null when the user cancels. Outside the app (the browser dev build) there is no native dialog.
 */
export async function pickFilePaths(): Promise<string[] | null> {
  if (!isTauri) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const selected = await open({ multiple: true, pickerMode: "document" })
  if (selected == null) return null
  return (Array.isArray(selected) ? selected : [selected]).filter((p): p is string => typeof p === "string")
}
