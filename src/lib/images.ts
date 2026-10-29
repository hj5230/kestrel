// Images are made acceptable to every vision API before they leave the composer: JPEG/PNG/WebP/GIF, at most
// 2048px on the long edge and under 3.75 MB, which base64-encodes to Anthropic's 5 MB per-image limit (OpenAI
// and Gemini allow more). The webview decodes and re-encodes what it can; formats it can't decode (HEIC in a
// Chromium preview, TIFF, AVIF on older WebKit) go to the Mac's ffmpeg instead.
import { rpc } from "./api"
import { t } from "./i18n"

export interface ImageData {
  data: string
  mimeType: string
  name: string
}

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const MAX_BYTES = 3.75 * 1024 * 1024
const MAX_EDGE = 2048
/** What the Mac is asked to convert in one request; larger originals are refused rather than shipped whole. */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif)$/i
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mpe?g|3gp|wmv|flv)$/i
export const isImageName = (name: string) => IMAGE_EXT.test(name)
export const isVideoName = (name: string) => VIDEO_EXT.test(name)
export const isVideo = (f: { type?: string; name: string }) => !!f.type?.startsWith("video/") || isVideoName(f.name)

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")!
  // JPEG has no alpha: transparent areas would turn black.
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((ok) => canvas.toBlob(ok, "image/jpeg", quality))
}

async function viaMac(file: File): Promise<ImageData> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error(t("composer.imageTooLarge"))
  const out = await rpc<{ data: string; mimeType: string }>("media.image", { data: base64(await file.arrayBuffer()), name: file.name })
  return { ...out, name: file.name || "image" }
}

export async function prepareImage(file: File): Promise<ImageData> {
  const name = file.name || "image"
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return viaMac(file)
  }
  try {
    if (ACCEPTED.has(file.type) && file.size <= MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) {
      return { data: base64(await file.arrayBuffer()), mimeType: file.type, name }
    }
    for (const [edge, quality] of [[MAX_EDGE, 0.86], [MAX_EDGE, 0.7], [1568, 0.7], [1024, 0.7]] as const) {
      const blob = await encode(bitmap, edge, quality)
      if (blob && blob.size <= MAX_BYTES) return { data: base64(await blob.arrayBuffer()), mimeType: "image/jpeg", name }
    }
    throw new Error(t("composer.imageTooLarge"))
  } finally {
    bitmap.close()
  }
}
