// One menu description, two presentations: a dropdown with side submenus for a mouse, and a bottom sheet
// that drills into submenus for a finger (side submenus run off a phone screen). A "panel" entry shows
// custom content, such as the folder browser, in a popover on desktop and as a page of the sheet on touch.
import { useRef, useState } from "preact/hooks"
import type { ComponentChildren, ComponentType } from "preact"
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"

type Icon = ComponentType<{ className?: string }>

export type MenuNode =
  | { kind: "item"; label: string; icon?: Icon; onSelect: () => void; disabled?: boolean; destructive?: boolean }
  | { kind: "sub"; label: string; icon?: Icon; children: MenuNode[] }
  | { kind: "radio"; label: string; icon?: Icon; value: string; options: { value: string; label: string; desc?: string }[]; onChange: (v: string) => void }
  | { kind: "panel"; label: string; icon?: Icon; className?: string; disabled?: boolean; render: (close: () => void) => ComponentChildren }
  | { kind: "separator" }

type Page = Extract<MenuNode, { kind: "sub" | "radio" | "panel" }>

function DesktopNodes({ nodes, onPanel }: { nodes: MenuNode[]; onPanel: (p: Extract<MenuNode, { kind: "panel" }>) => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.kind === "separator") return <DropdownMenuSeparator key={i} />
        const Ico = n.icon
        if (n.kind === "item")
          return (
            <DropdownMenuItem key={i} disabled={n.disabled} variant={n.destructive ? "destructive" : "default"} onSelect={n.onSelect}>
              {Ico && <Ico />}
              {n.label}
            </DropdownMenuItem>
          )
        if (n.kind === "panel")
          return (
            <DropdownMenuItem key={i} disabled={n.disabled} onSelect={() => onPanel(n)}>
              {Ico && <Ico />}
              {n.label}
            </DropdownMenuItem>
          )
        return (
          <DropdownMenuSub key={i}>
            <DropdownMenuSubTrigger>
              {Ico && <Ico />}
              {n.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={n.kind === "radio" ? "w-72" : "min-w-48"}>
              {n.kind === "sub" ? (
                <DesktopNodes nodes={n.children} onPanel={onPanel} />
              ) : (
                <>
                  <DropdownMenuLabel>{n.label}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={n.value} onValueChange={n.onChange}>
                    {n.options.map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value} className="items-start py-1.5">
                        <div>
                          <div>{o.label}</div>
                          {o.desc && <div className="text-xs text-muted-foreground">{o.desc}</div>}
                        </div>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

const ROW = "flex w-full min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left text-base disabled:pointer-events-none disabled:opacity-50 active:bg-accent [&_svg]:size-4.5 [&_svg]:shrink-0"

function TouchNodes({ nodes, onOpen, close }: { nodes: MenuNode[]; onOpen: (p: Page) => void; close: () => void }) {
  return (
    <div className="grid">
      {nodes.map((n, i) => {
        if (n.kind === "separator") return <div key={i} className="my-1 h-px bg-border" />
        const Ico = n.icon
        if (n.kind === "item")
          return (
            <button
              key={i}
              type="button"
              disabled={n.disabled}
              className={cn(ROW, n.destructive && "text-destructive")}
              onClick={() => {
                close()
                n.onSelect()
              }}
            >
              {Ico && <Ico className={n.destructive ? "" : "text-muted-foreground"} />}
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
            </button>
          )
        const current = n.kind === "radio" ? n.options.find((o) => o.value === n.value)?.label : undefined
        return (
          <button key={i} type="button" disabled={n.kind === "panel" && n.disabled} className={ROW} onClick={() => onOpen(n)}>
            {Ico && <Ico className="text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{n.label}</span>
            {current && <span className="shrink-0 text-sm text-muted-foreground">{current}</span>}
            {n.kind !== "panel" && <ChevronRightIcon className="text-muted-foreground/70" />}
          </button>
        )
      })}
    </div>
  )
}

function TouchPage({ page, onOpen, close }: { page: Page; onOpen: (p: Page) => void; close: () => void }) {
  if (page.kind === "panel") return <>{page.render(close)}</>
  if (page.kind === "sub") return <TouchNodes nodes={page.children} onOpen={onOpen} close={close} />
  return (
    <div className="grid" role="radiogroup" aria-label={page.label}>
      {page.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === page.value}
          className={cn(ROW, "items-start")}
          onClick={() => {
            page.onChange(o.value)
            close()
          }}
        >
          <span className="min-w-0 flex-1">
            <span className="block">{o.label}</span>
            {o.desc && <span className="mt-0.5 block text-sm text-muted-foreground">{o.desc}</span>}
          </span>
          <CheckIcon className={cn("mt-1 text-primary", o.value !== page.value && "invisible")} />
        </button>
      ))}
    </div>
  )
}

export function ActionMenu({
  trigger,
  nodes,
  title,
  align = "end",
  className = "w-56",
  anchorClassName,
}: {
  trigger: ComponentChildren
  nodes: MenuNode[]
  /** Read by screen readers as the sheet's name on touch. */
  title: string
  align?: "start" | "end"
  className?: string
  /** Layout for the wrapper the desktop panel popover anchors to (e.g. `min-w-0` for a truncating trigger). */
  anchorClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [stack, setStack] = useState<Page[]>([])
  const [panel, setPanel] = useState<Extract<MenuNode, { kind: "panel" }> | null>(null)
  // Set while the dropdown closes so that it doesn't hand focus back to the trigger and close the panel at once.
  const pending = useRef<Extract<MenuNode, { kind: "panel" }> | null>(null)

  if (isTouch) {
    const page = stack[stack.length - 1]
    const close = () => {
      setOpen(false)
      setStack([])
    }
    return (
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setStack([])
        }}
      >
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ bottom: "var(--kb, 0px)", maxHeight: "min(80vh, calc(var(--app-height, 100vh) - 24px))" }}
          className="gap-0 overflow-y-auto overscroll-contain rounded-t-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] [html.keyboard-open_&]:pb-2"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{page?.label ?? title}</SheetTitle>
            <SheetDescription>{title}</SheetDescription>
          </SheetHeader>
          {page && (
            <button type="button" className="flex min-h-11 items-center gap-1.5 px-2 text-base text-muted-foreground" onClick={() => setStack(stack.slice(0, -1))}>
              <ChevronLeftIcon className="size-4.5" />
              {page.label}
            </button>
          )}
          {page ? <TouchPage page={page} onOpen={(p) => setStack([...stack, p])} close={close} /> : <TouchNodes nodes={nodes} onOpen={(p) => setStack([p])} close={close} />}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={!!panel} onOpenChange={(o) => !o && setPanel(null)}>
      <PopoverAnchor asChild>
        <span className={cn("inline-flex", anchorClassName)}>
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent
              align={align}
              className={className}
              onCloseAutoFocus={(e) => {
                const p = pending.current
                if (!p) return
                e.preventDefault()
                pending.current = null
                setPanel(p)
              }}
            >
              <DesktopNodes nodes={nodes} onPanel={(p) => (pending.current = p)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </PopoverAnchor>
      <PopoverContent align={align} className={cn("p-0", panel?.className ?? "w-80")}>
        {panel?.render(() => setPanel(null))}
      </PopoverContent>
    </Popover>
  )
}
