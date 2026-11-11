// The message input: a Markdown editor with completions, pending attachments, send and stop inside the box,
// and a toolbar under it (add, then whatever the page puts there: permission mode, model). The pieces live
// in composer/; this wires them together and owns sending.
import { useEffect, useRef, useState } from "preact/hooks"
import type { ComponentChildren } from "preact"
import { toast } from "sonner"
import type { StagedFile } from "@/lib/api"
import { settings } from "@/lib/store"
import { isMobileApp, isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { AddMenu } from "./composer/add-menu"
import { AttachmentStrip } from "./composer/attachment-strip"
import { CompletionMenu, useCompletions, type MenuItem } from "./composer/completions"
import { Editor } from "./composer/editor"
import { handleComposerKey } from "./composer/keys"
import { SendButtons } from "./composer/send-buttons"
import { useAttachments, type Attachment } from "./composer/use-attachments"
import { useAutosize } from "./composer/use-autosize"
import { useDraft } from "./composer/use-draft"

export type { Attachment } from "./composer/use-attachments"

export interface ComposerProps {
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
  /** Sits at the far end of the toolbar. The model and its reasoning effort. */
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
}

export function Composer(props: ComposerProps) {
  const { cwd, running, disabled, onSubmit, onAbort, onBuiltin, folder, draftKey, history = [], vision = true } = props
  const { text, setText, persist, clear } = useDraft(draftKey)
  const att = useAttachments(vision)
  const [caret, setCaret] = useState(0)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [dragging, setDragging] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const sendKey = settings.value?.sendKey ?? "enter"
  const menu = useCompletions(cwd, text, caret)
  useAutosize(ta, mirror, text)

  const placeCaret = (pos: number) =>
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })

  useEffect(() => {
    if (!props.initial) return
    setText(props.initial.text)
    placeCaret(props.initial.text.length)
  }, [props.initial?.nonce])

  // On touch devices focusing pops the keyboard over the conversation; let the user tap in.
  useEffect(() => {
    if (props.autoFocus && !isTouch) ta.current?.focus()
  }, [props.autoFocus])

  const pick = (item: MenuItem) => {
    const next = menu.apply(item)
    setText(next.text)
    placeCaret(next.caret)
  }

  const submit = async () => {
    const value = text.trim()
    if ((!value && !att.images.length && !att.files.length) || disabled) return
    const builtin = /^\/(\S+)\s*([\s\S]*)$/.exec(value)
    if (builtin && onBuiltin?.(builtin[1], builtin[2])) return clear()
    const previous = text
    const taken = att.take()
    clear()
    setHistoryIndex(-1)
    const restore = () => {
      setText(previous)
      persist(previous)
      att.restore(taken)
    }
    try {
      if ((await onSubmit(value, taken.images, taken.files)) === false) restore()
    } catch (e: any) {
      toast.error(e?.message ?? String(e))
      restore()
    }
  }

  const onKeyDown = (e: KeyboardEvent) =>
    handleComposerKey(e, {
      menu: { open: menu.open, items: menu.items, index: menu.index, setIndex: menu.setIndex, pick, dismiss: menu.dismiss },
      running,
      onAbort,
      history,
      historyIndex,
      setHistoryIndex,
      text,
      setText,
      atStart: (ta.current?.selectionStart ?? 0) === 0,
      sendKey,
      submit,
      selection: [ta.current?.selectionStart ?? 0, ta.current?.selectionEnd ?? 0],
      edit: (next) => {
        const el = ta.current
        if (!el) return
        const start = el.selectionStart
        // insertText goes through the textarea's own editing, so ⌘Z undoes it and onInput syncs the state.
        if (document.execCommand("insertText", false, next.insert)) {
          // Same tick, so the next keystroke already lands inside the block.
          el.setSelectionRange(start + next.caret, start + next.caret)
          setCaret(start + next.caret)
        } else {
          setText(next.text)
          persist(next.text)
          placeCaret(start + next.caret)
        }
      },
    })

  const canSend = (text.trim().length > 0 || att.images.length > 0 || att.files.length > 0) && !disabled && att.converting === 0

  return (
    <div className="relative">
      {menu.open && <CompletionMenu items={menu.items} index={menu.index} below={props.menuBelow} onHover={menu.setIndex} onPick={pick} />}
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
          if (!e.dataTransfer?.files) return
          att.addImages(e.dataTransfer.files)
          if (!isMobileApp) att.addFiles(e.dataTransfer.files)
        }}
      >
        <AttachmentStrip images={att.images} files={att.files} converting={att.converting} onRemoveImage={att.removeImage} onRemoveFile={att.removeFile} />
        <div className="flex items-end gap-1.5">
          <Editor
            ta={ta}
            mirror={mirror}
            text={text}
            placeholder={props.placeholder}
            onText={(value, pos) => {
              setText(value)
              setCaret(pos)
              menu.reset()
            }}
            onCaret={setCaret}
            onKeyDown={onKeyDown}
            onPasteImages={att.addImages}
          />
          <SendButtons running={running} canSend={canSend} preparing={att.converting > 0} sendKey={sendKey} onSend={submit} onStop={onAbort} />
        </div>
      </div>
      <div data-slot="composer-toolbar" className="flex min-w-0 items-center gap-0.5 px-1">
        <AddMenu vision={vision} folder={folder} onImages={att.addImages} onFiles={att.addFiles} onStage={att.stage} />
        {props.toolbarStart}
        <div className="min-w-2 flex-1" />
        {props.toolbarEnd}
      </div>
      {props.footer}
    </div>
  )
}
