import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import type { ComponentChildren } from "preact"
import { ArrowUpIcon, FileIcon, ImagePlusIcon, SparklesIcon, SquareIcon, TerminalSquareIcon, XIcon, ZapIcon } from "lucide-react"
import type { SlashCommandInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { rpc } from "@/lib/api"
import { settings } from "@/lib/store"
import { cn } from "@/lib/utils"
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
const KIND_LABEL = { builtin: "命令", prompt: "自定义", skill: "技能", file: "文件" }

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) return reject(new Error("图片不能超过 10MB"))
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
  toolbar,
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
  onSubmit: (text: string, images: Attachment[]) => Promise<boolean | void> | boolean | void
  onAbort?: () => void
  onBuiltin?: (name: string, args: string) => boolean
  toolbar?: ComponentChildren
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
      return localStorage.getItem(`helm-draft:${draftKey}`) ?? ""
    } catch {
      return ""
    }
  })
  const [images, setImages] = useState<Attachment[]>([])
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [histIdx, setHistIdx] = useState(-1)
  const [dragging, setDragging] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    if (!draftKey) return
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(`helm-draft:${draftKey}`, text)
        else localStorage.removeItem(`helm-draft:${draftKey}`)
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [text, draftKey])

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [text])

  useEffect(() => {
    if (autoFocus) ta.current?.focus()
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
    if ((!value && !images.length) || disabled) return
    const builtin = /^\/(\S+)\s*([\s\S]*)$/.exec(value)
    if (builtin && onBuiltin && onBuiltin(builtin[1], builtin[2])) {
      setText("")
      return
    }
    const prevText = text
    const prevImages = images
    setText("")
    setImages([])
    setHistIdx(-1)
    try {
      const ok = await onSubmit(value, prevImages)
      if (ok === false) {
        setText(prevText)
        setImages(prevImages)
      }
    } catch (e: any) {
      toast.error(e?.message ?? String(e))
      setText(prevText)
      setImages(prevImages)
    }
  }

  const addFiles = async (list: FileList | File[]) => {
    const imgs = [...list].filter((f) => f.type.startsWith("image/"))
    if (!imgs.length) return
    try {
      const read = await Promise.all(imgs.map(readImage))
      setImages((cur) => [...cur, ...read].slice(0, 8))
    } catch (e: any) {
      toast.error(e.message)
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
    if (e.key === "Enter") {
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

  const canSend = (text.trim().length > 0 || images.length > 0) && !disabled

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
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm", i === menuIndex && "bg-accent text-accent-foreground")}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={cn("shrink-0", item.kind === "file" ? "truncate font-mono text-xs" : "font-medium")}>{item.label}</span>
                {item.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.detail}</span>}
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{KIND_LABEL[item.kind]}</span>
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
          if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
        }}
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((img, i) => (
              <div key={i} className="group/img relative">
                <img src={`data:${img.mimeType};base64,${img.data}`} className="size-16 rounded-lg border object-cover" />
                <button
                  type="button"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-background shadow group-hover/img:flex"
                >
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
          placeholder={placeholder ?? "给 Helm 布置任务…  / 调用命令与技能，@ 引用文件"}
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
                addFiles(imgs)
              }
            }
          }}
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => fileInput.current?.click()}>
                <ImagePlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>添加图片（也可粘贴或拖入）</TooltipContent>
          </Tooltip>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.currentTarget.files) addFiles(e.currentTarget.files)
              e.currentTarget.value = ""
            }}
          />
          {toolbar}
          <div className="ml-auto flex items-center gap-1.5">
            {running && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="secondary" onClick={onAbort} className="rounded-full">
                    <SquareIcon className="fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  停止 <Kbd>Esc</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
            {(!running || canSend) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" disabled={!canSend} onClick={submit} className="rounded-full">
                    <ArrowUpIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {running ? "插话：在当前步骤后加入" : "发送"} <Kbd>{sendKey === "enter" ? "↵" : "⌘↵"}</Kbd>
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
