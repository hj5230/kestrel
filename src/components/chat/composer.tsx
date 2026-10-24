import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import type { ComponentChildren } from "preact"
import { ArrowUpIcon, ChevronLeftIcon, FileIcon, FolderIcon, ImagePlusIcon, PaperclipIcon, PlusIcon, SparklesIcon, SquareIcon, TerminalSquareIcon, XIcon, ZapIcon } from "lucide-react"
import { FILE_ATTACHMENT_MAX_BYTES, type SlashCommandInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { rpc } from "@/lib/api"
import { settings } from "@/lib/store"
import { isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t, type MessageKey } from "@/lib/i18n"
import { CwdBrowser } from "./pickers"
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

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) return reject(new Error(t("composer.imageTooLarge")))
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      resolve({ data: s.slice(s.indexOf(",") + 1), mimeType: file.type || "image/png", name: file.name || "image" })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

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
  allowFiles = false,
  draftKey,
  history = [],
  placeholder,
  autoFocus,
  footer,
  initial,
  menuBelow,
}: {
  cwd: string
  running?: boolean
  disabled?: boolean
  onSubmit: (text: string, images: Attachment[], files: File[]) => Promise<boolean | void> | boolean | void
  onAbort?: () => void
  onBuiltin?: (name: string, args: string) => boolean
  /** Where this task runs. Omitted once a session has messages, since the folder is fixed by then. */
  folder?: { value: string; onChange: (v: string) => void }
  /** Sits next to the add button. The permission mode. */
  toolbarStart?: ComponentChildren
  /** Sits before the send button. The model and its reasoning effort. */
  toolbarEnd?: ComponentChildren
  /** File attachments upload to the desktop. The phone has no upload path yet. */
  allowFiles?: boolean
  draftKey?: string
  history?: string[]
  placeholder?: string
  autoFocus?: boolean
  footer?: ComponentChildren
  initial?: { text: string; nonce: number } | null
  menuBelow?: boolean
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
  const [attachments, setAttachments] = useState<File[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [histIdx, setHistIdx] = useState(-1)
  const [dragging, setDragging] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
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

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [text])

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
    const imgs = [...list].filter((f) => f.type.startsWith("image/"))
    if (!imgs.length) return
    try {
      const read = await Promise.all(imgs.map(readImage))
      setImages((cur) => [...cur, ...read].slice(0, 8))
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const addAttachments = (list: FileList | File[]) => {
    const next = [...list].filter((f) => !f.type.startsWith("image/"))
    const tooBig = next.filter((f) => f.size > FILE_ATTACHMENT_MAX_BYTES)
    if (tooBig.length) toast.error(t("composer.fileTooLarge"))
    const ok = next.filter((f) => f.size <= FILE_ATTACHMENT_MAX_BYTES)
    if (ok.length) setAttachments((cur) => [...cur, ...ok].slice(0, 8))
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

  const canSend = (text.trim().length > 0 || images.length > 0 || attachments.length > 0) && !disabled

  const addButton = (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground pointer-coarse:min-h-10 pointer-coarse:min-w-10" aria-label={t("composer.add")}>
      <PlusIcon />
    </Button>
  )
  const addItems = (
    <div className="grid p-1">
      <button
        type="button"
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
        onClick={() => {
          setAddOpen(false)
          imageInput.current?.click()
        }}
      >
        <ImagePlusIcon className="size-4 text-muted-foreground" />
        {t("composer.addImage")}
      </button>
      {allowFiles && (
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
          onClick={() => {
            setAddOpen(false)
            fileInput.current?.click()
          }}
        >
          <PaperclipIcon className="size-4 text-muted-foreground" />
          {t("composer.addFile")}
        </button>
      )}
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
            if (allowFiles) addAttachments(e.dataTransfer.files)
          }
        }}
      >
        {(images.length > 0 || attachments.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
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
                <span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
                <button type="button" onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground pointer-coarse:-m-1 pointer-coarse:p-1">
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={placeholder ?? t("composer.placeholder")}
          className="block max-h-80 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.94rem] leading-relaxed outline-none placeholder:text-muted-foreground/70"
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
              const imgs = [...items].filter((f) => f.type.startsWith("image/"))
              if (imgs.length) {
                e.preventDefault()
                addImages(imgs)
              }
            }
          }}
        />
        <div data-slot="composer-toolbar" className="flex items-center gap-0.5 px-1.5 pb-1.5">
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
            accept="image/*"
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
          <div className="flex shrink-0 items-center gap-1.5 pl-1">
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
                    <ArrowUpIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {running ? t("composer.steer") : t("composer.send")} <Kbd>{sendKey === "enter" ? "↵" : "⌘↵"}</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      {footer}
    </div>
  )
}
