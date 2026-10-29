import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import type { ComponentChildren } from "preact"
import { ArrowUpIcon, ChevronLeftIcon, FileIcon, FolderIcon, ImagePlusIcon, PaperclipIcon, PlusIcon, SparklesIcon, SquareIcon, TerminalSquareIcon, XIcon, ZapIcon } from "lucide-react"
import { FILE_ATTACHMENT_MAX_BYTES, type SlashCommandInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { rpc, type StagedFile } from "@/lib/api"
import { pickFilePaths } from "@/lib/attach"
import { isImageName, prepareImage } from "@/lib/images"
import { settings } from "@/lib/store"
import { isMobileApp, isTauri, isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"
import { CwdBrowser } from "./pickers"
import { highlightMarkdownSource } from "./md-source"
import { toast } from "sonner"

export interface Attachment {
  data: string
  mimeType: string
  name: string
}

interface MenuItem {
  key: string
  label: string
  detail?: string
  kind: "builtin" | "prompt" | "skill" | "file"
  insert: string
}

const KIND_ICON = { builtin: TerminalSquareIcon, prompt: ZapIcon, skill: SparklesIcon, file: FileIcon }


function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
}

const isImageFile = (f: File) => f.type.startsWith("image/") || isImageName(f.name)

export function Composer({
  cwd,
  running,
  disabled,
  onSubmit,
  onAbort,
  onBuiltin,
  folder,
  toolbarStart,
  toolbarEnd,
  draftKey,
  history = [],
  placeholder,
  autoFocus,
  footer,
  initial,
  menuBelow,
  vision = true,
}: {
  cwd: string
  running?: boolean
  disabled?: boolean
  onSubmit: (text: string, images: Attachment[], files: StagedFile[]) => Promise<boolean | void> | boolean | void
  onAbort?: () => void
  onBuiltin?: (name: string, args: string) => boolean
  /** Where this task runs. Omitted once a session has messages, since the folder is fixed by then. */
  folder?: { value: string; onChange: (v: string) => void }
  /** Sits next to the add button. The permission mode. */
  toolbarStart?: ComponentChildren
  /** Sits before the send button. The model and its reasoning effort. */
  toolbarEnd?: ComponentChildren
  draftKey?: string
  history?: string[]
  placeholder?: string
  autoFocus?: boolean
  footer?: ComponentChildren
  initial?: { text: string; nonce: number } | null
  menuBelow?: boolean
  /** The selected model reads images. Off: pictures can't be attached, and pasted or dropped ones are refused. */
  vision?: boolean
}) {
  const [text, setText] = useState(() => {
    if (!draftKey) return ""
    try {
      return localStorage.getItem(`kestrel-draft:${draftKey}`) ?? ""
    } catch {
      return ""
    }
  })
  const [images, setImages] = useState<Attachment[]>([])
  const [attachments, setAttachments] = useState<StagedFile[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [histIdx, setHistIdx] = useState(-1)
  const [dragging, setDragging] = useState(false)
  const [converting, setConverting] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sendKey = settings.value?.sendKey ?? "enter"

  useEffect(() => {
    rpc<SlashCommandInfo[]>("commands.list", { cwd }).then(setCommands).catch(() => {})
  }, [cwd])

  useEffect(() => {
    if (initial) {
      setText(initial.text)
      requestAnimationFrame(() => {
        ta.current?.focus()
        ta.current?.setSelectionRange(initial.text.length, initial.text.length)
      })
    }
  }, [initial?.nonce])

  const latestText = useRef(text)
  latestText.current = text

  const persistDraft = (value: string) => {
    if (!draftKey) return
    try {
      if (value) localStorage.setItem(`kestrel-draft:${draftKey}`, value)
      else localStorage.removeItem(`kestrel-draft:${draftKey}`)
    } catch {}
  }

  useEffect(() => {
    if (!draftKey) return
    const t = setTimeout(() => persistDraft(text), 300)
    return () => clearTimeout(t)
  }, [text, draftKey])

  useEffect(() => () => persistDraft(latestText.current), [draftKey])

  const fit = () => {
    const el = ta.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
    // Sub-pixel line heights make a one-line box a fraction taller than its content; only scroll once the cap is hit.
    el.style.overflowY = el.scrollHeight > 320 ? "auto" : "hidden"
    if (mirror.current) mirror.current.scrollTop = el.scrollTop
  }
  useLayoutEffect(fit, [text])
  // The height depends on the width too: measured while the window or sidebar was resizing, it stays stale.
  useEffect(() => {
    const el = ta.current
    if (!el) return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // On touch devices focusing pops the keyboard over the conversation; let the user tap in.
  useEffect(() => {
    if (autoFocus && !isTouch) ta.current?.focus()
  }, [autoFocus])

  const before = text.slice(0, caret)
  const slashMatch = /^\/(\S*)$/.exec(before)
  const mentionMatch = !slashMatch ? /(^|\s)@([^\s@]*)$/.exec(before) : null
  const mentionQuery = mentionMatch?.[2] ?? null

  useEffect(() => {
    if (mentionQuery === null) return
    const t = setTimeout(() => {
      rpc<string[]>("fs.complete", { cwd, query: mentionQuery, limit: 12 }).then(setFiles).catch(() => setFiles([]))
    }, 80)
    return () => clearTimeout(t)
  }, [mentionQuery, cwd])

  const menu: MenuItem[] = useMemo(() => {
    if (slashMatch) {
      const q = slashMatch[1].toLowerCase()
      return commands
        .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
        .slice(0, 50)
        .map((c) => ({ key: `${c.kind}:${c.name}`, label: `/${c.name}`, detail: c.description, kind: c.kind, insert: `/${c.name} ` }))
    }
    if (mentionMatch) {
      return files.map((f) => ({ key: f, label: f, kind: "file" as const, insert: `@${f} ` }))
    }
    return []
  }, [slashMatch?.[1], mentionMatch?.[2], commands, files])

  const menuKey = slashMatch ? `/${slashMatch[1]}` : mentionMatch ? `@${mentionMatch[2]}` : null
  const menuOpen = menu.length > 0 && menuKey !== null && dismissed !== menuKey

  useEffect(() => setMenuIndex(0), [menuKey])

  const applyItem = (item: MenuItem) => {
    let next: string
    if (item.kind === "file" && mentionMatch) {
      const start = caret - mentionMatch[2].length - 1
      next = text.slice(0, start) + item.insert + text.slice(caret)
      const pos = start + item.insert.length
      setText(next)
      requestAnimationFrame(() => {
        ta.current?.setSelectionRange(pos, pos)
        setCaret(pos)
      })
    } else {
      next = item.insert + text.slice(caret)
      setText(next)
      requestAnimationFrame(() => {
        ta.current?.setSelectionRange(item.insert.length, item.insert.length)
        setCaret(item.insert.length)
      })
    }
    ta.current?.focus()
  }

  const submit = async () => {
    const value = text.trim()
    if ((!value && !images.length && !attachments.length) || disabled) return
    const builtin = /^\/(\S+)\s*([\s\S]*)$/.exec(value)
    if (builtin && onBuiltin && onBuiltin(builtin[1], builtin[2])) {
      setText("")
      persistDraft("")
      return
    }
    const prevText = text
    const prevImages = images
    const prevFiles = attachments
    setText("")
    latestText.current = ""
    persistDraft("")
    setImages([])
    setAttachments([])
    setHistIdx(-1)
    try {
      const ok = await onSubmit(value, prevImages, prevFiles)
      if (ok === false) {
        setText(prevText)
        persistDraft(prevText)
        setImages(prevImages)
        setAttachments(prevFiles)
      }
    } catch (e: any) {
      toast.error(e?.message ?? String(e))
      setText(prevText)
      persistDraft(prevText)
      setImages(prevImages)
      setAttachments(prevFiles)
    }
  }

  const addImages = async (list: FileList | File[]) => {
    const imgs = [...list].filter(isImageFile)
    if (!imgs.length) return
    if (!vision) {
      toast.error(t("composer.noVision"))
      return
    }
    setConverting((n) => n + imgs.length)
    // Each picture is resized or converted on its own, so one unreadable file doesn't drop the rest.
    await Promise.all(
      imgs.map((f) =>
        prepareImage(f)
          .then((img) => setImages((cur) => [...cur, img].slice(0, 8)))
          .catch((e: any) => toast.error(`${f.name || t("common.image")}: ${e?.message ?? String(e)}`))
          .finally(() => setConverting((n) => n - 1)),
      ),
    )
  }

  const stage = (next: StagedFile[]) => {
    if (next.length) setAttachments((cur) => [...cur, ...next].slice(0, 8))
  }

  const addAttachments = (list: FileList | File[]) => {
    const next = [...list].filter((f) => !isImageFile(f))
    const tooBig = next.filter((f) => f.size > FILE_ATTACHMENT_MAX_BYTES)
    if (tooBig.length) toast.error(t("composer.fileTooLarge"))
    stage(next.filter((f) => f.size <= FILE_ATTACHMENT_MAX_BYTES).map((file) => ({ name: file.name, size: file.size, file })))
  }

  /** Images use the webview's input, which offers Take Photo and the library on iOS and arrives as pixels for the model. Other files use the system document picker. */
  const chooseImage = () => {
    setAddOpen(false)
    imageInput.current?.click()
  }
  const chooseFile = async () => {
    setAddOpen(false)
    if (!isTauri) {
      fileInput.current?.click()
      return
    }
    try {
      const paths = await pickFilePaths()
      if (!paths?.length) return
      stage(paths.map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })))
    } catch (e: any) {
      toast.error(e?.message ?? String(e))
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % menu.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + menu.length) % menu.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        applyItem(menu[menuIndex])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setDismissed(menuKey)
        return
      }
    }
    if (e.key === "Escape" && running && onAbort) {
      e.preventDefault()
      onAbort()
      return
    }
    if (e.key === "ArrowUp" && history.length && (text === "" || histIdx >= 0) && (ta.current?.selectionStart ?? 0) === 0) {
      e.preventDefault()
      const next = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(next)
      setText(history[history.length - 1 - next])
      return
    }
    if (e.key === "ArrowDown" && histIdx >= 0) {
      e.preventDefault()
      const next = histIdx - 1
      setHistIdx(next)
      setText(next >= 0 ? history[history.length - 1 - next] : "")
      return
    }
    // A software keyboard's return key inserts a newline; sending is the button's job.
    if (e.key === "Enter" && !isTouch) {
      const mod = e.metaKey || e.ctrlKey
      const shouldSend = sendKey === "enter" ? !e.shiftKey && !mod : mod
      if (shouldSend) {
        e.preventDefault()
        submit()
      } else if (sendKey === "enter" && mod) {
        e.preventDefault()
        submit()
      }
    }
  }

  const canSend = (text.trim().length > 0 || images.length > 0 || attachments.length > 0) && !disabled && converting === 0

  const addButton = (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground pointer-coarse:min-h-10 pointer-coarse:min-w-10" aria-label={t("composer.add")}>
      <PlusIcon />
    </Button>
  )
  const addItems = (
    <div className="grid p-1">
      <button
        type="button"
        disabled={!vision}
        title={vision ? undefined : t("composer.noVision")}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11"
        onClick={chooseImage}
      >
        <ImagePlusIcon className="size-4 text-muted-foreground" />
        {t("composer.addImage")}
      </button>
      <button
        type="button"
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
        onClick={chooseFile}
      >
        <PaperclipIcon className="size-4 text-muted-foreground" />
        {t("composer.addFile")}
      </button>
      {folder && (
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
          onClick={() => setPickingFolder(true)}
        >
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{t("composer.folder")}</span>
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{folder.value || "~"}</span>
        </button>
      )}
    </div>
  )
  const closeAdd = (open: boolean) => {
    setAddOpen(open)
    if (!open) setPickingFolder(false)
  }
  const addPanel = pickingFolder && folder ? (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
        onClick={() => setPickingFolder(false)}
      >
        <ChevronLeftIcon className="size-4" />
        {t("composer.folder")}
      </button>
      <CwdBrowser
        value={folder.value}
        onChange={folder.onChange}
        onDone={() => {
          setPickingFolder(false)
          setAddOpen(false)
        }}
      />
    </div>
  ) : (
    addItems
  )

  return (
    <div className="relative">
      {menuOpen && (
        <div className={cn("absolute inset-x-0 z-30 max-h-72", menuBelow ? "top-full mt-2" : "bottom-full mb-2", "overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg")}>
          {menu.map((item, i) => {
            const Icon = KIND_ICON[item.kind]
            return (
              <button
                key={item.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyItem(item)
                }}
                onMouseEnter={() => setMenuIndex(i)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm pointer-coarse:min-h-11", i === menuIndex && "bg-accent text-accent-foreground")}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={cn("shrink-0", item.kind === "file" ? "truncate font-mono text-xs" : "font-medium")}>{item.label}</span>
                {item.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.detail}</span>}
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{t(`composer.kind.${item.kind}` as MessageKey)}</span>
              </button>
            )
          })}
        </div>
      )}
      <div
        className={cn(
          "rounded-2xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-md",
          dragging && "border-primary ring-4 ring-primary/15",
        )}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer?.files) {
            addImages(e.dataTransfer.files)
            if (!isMobileApp) addAttachments(e.dataTransfer.files)
          }
        }}
      >
        {(images.length > 0 || attachments.length > 0 || converting > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {converting > 0 && (
              <div className="flex size-16 items-center justify-center rounded-lg border text-muted-foreground" aria-label={t("composer.preparing")}>
                <Spinner />
              </div>
            )}
            {images.map((img, i) => (
              <div key={i} className="group/img relative">
                <img src={`data:${img.mimeType};base64,${img.data}`} className="size-16 rounded-lg border object-cover" />
                <button
                  type="button"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background shadow group-hover/img:flex pointer-coarse:-top-2.5 pointer-coarse:-right-2.5 pointer-coarse:flex pointer-coarse:size-7"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
            {attachments.map((file, i) => (
              <div key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-40 truncate">{file.name}</span>
                {file.size != null && <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>}
                <button type="button" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground pointer-coarse:-m-1 pointer-coarse:p-1">
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <div className="relative min-w-0 flex-1">
            {/* The highlighted copy sits under a transparent textarea: same box, font and wrapping, so the caret and IME stay native. */}
            <div
              ref={mirror}
              aria-hidden="true"
              className="md-source pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 text-[0.94rem] leading-relaxed break-words whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: text ? highlightMarkdownSource(text) : "" }}
            />
            <textarea
              ref={ta}
              rows={1}
              value={text}
              placeholder={placeholder ?? t("composer.placeholder")}
              className="relative block max-h-80 w-full resize-none bg-transparent px-4 py-3 text-[0.94rem] leading-relaxed break-words whitespace-pre-wrap text-transparent caret-foreground outline-none selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground/70"
              onScroll={(e) => mirror.current && (mirror.current.scrollTop = e.currentTarget.scrollTop)}
              onInput={(e) => {
                setText(e.currentTarget.value)
                setCaret(e.currentTarget.selectionStart ?? 0)
                setDismissed(null)
              }}
              onKeyDown={onKeyDown as any}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onPaste={(e) => {
                const items = e.clipboardData?.files
                if (items && items.length) {
                  const imgs = [...items].filter(isImageFile)
                  if (imgs.length) {
                    e.preventDefault()
                    addImages(imgs)
                  }
                }
              }}
            />
          </div>
          <div className="mr-2 mb-2.5 flex shrink-0 items-center gap-1.5">
            {running && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="secondary" aria-label={t("composer.stop")} onClick={onAbort} className="rounded-full">
                    <SquareIcon className="fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("composer.stop")} <Kbd>Esc</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
            {(!running || canSend) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" disabled={!canSend} aria-label={running ? t("composer.steer") : t("composer.send")} onClick={submit} className="rounded-full">
                    {converting > 0 ? <Spinner /> : <ArrowUpIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {converting > 0 ? t("composer.preparing") : running ? t("composer.steer") : t("composer.send")} {converting === 0 && <Kbd>{sendKey === "enter" ? "↵" : "⌘↵"}</Kbd>}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <div data-slot="composer-toolbar" className="flex min-w-0 items-center gap-0.5 px-1">
        {isTouch ? (
          <Sheet open={addOpen} onOpenChange={closeAdd}>
            <SheetTrigger asChild>{addButton}</SheetTrigger>
            <SheetContent side="bottom" showCloseButton={false} className="max-h-[75vh] gap-0 rounded-t-2xl p-1">
              {addPanel}
            </SheetContent>
          </Sheet>
        ) : (
          <Popover open={addOpen} onOpenChange={closeAdd}>
            <PopoverTrigger asChild>{addButton}</PopoverTrigger>
            <PopoverContent align="start" side="top" className={cn("p-0", pickingFolder ? "w-[min(24rem,calc(100vw-1.5rem))]" : "w-64")}>
              {addPanel}
            </PopoverContent>
          </Popover>
        )}
        <input
          ref={imageInput}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.currentTarget.files) addImages(e.currentTarget.files)
            e.currentTarget.value = ""
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.currentTarget.files) addAttachments(e.currentTarget.files)
            e.currentTarget.value = ""
          }}
        />
        {toolbarStart}
        <div className="min-w-0 flex-1" />
        {toolbarEnd}
      </div>
      {footer}
    </div>
  )
}
