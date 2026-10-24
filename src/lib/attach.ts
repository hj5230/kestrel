import { isTauri } from "./platform"

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff"]

/**
 * The system file dialog, not the webview's file input.
 * Images open the photo library on iOS and an image-only panel on the Mac.
 * Files open the document picker, which is a different dialog.
 * Returns null when the user cancels. Outside the app (the browser dev build) there is no native dialog.
 */
export async function pickPaths(kind: "image" | "file"): Promise<string[] | null> {
  if (!isTauri) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const selected = await open(
    kind === "image"
      ? { multiple: true, pickerMode: "image", filters: [{ name: "Images", extensions: IMAGE_EXT }] }
      : { multiple: true, pickerMode: "document" },
  )
  if (selected == null) return null
  const paths = (Array.isArray(selected) ? selected : [selected]).filter((p): p is string => typeof p === "string")
  return paths
}
