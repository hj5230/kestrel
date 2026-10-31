import type { ComponentChildren } from "preact"
import type { PermissionMode } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { isTouch } from "@/lib/platform"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
export { ModelPicker, effortLabel, ModelControl, ThinkingPicker } from "./model-picker"
export { CwdBrowser, CwdPicker } from "./cwd-picker"

/** A popover on desktop, a bottom sheet on touch, where a floating panel ends up behind the keyboard.
 *  The sheet rides on top of the keyboard (--kb) and never grabs focus on open, so the keyboard only
 *  appears when the search field is tapped. */
export function Panel({
  open,
  onOpenChange,
  align = "start",
  side,
  popoverClassName = "w-80 p-0",
  sheetClassName = "p-0",
  trigger,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: "start" | "end"
  side?: "top" | "bottom"
  popoverClassName?: string
  sheetClassName?: string
  trigger: ComponentChildren
  children: ComponentChildren
}) {
  if (isTouch) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ bottom: "var(--kb, 0px)", maxHeight: "min(75vh, calc(var(--app-height, 100vh) - 24px))" }}
          className={cn("gap-0 overflow-y-auto overscroll-contain rounded-t-2xl", "[html.keyboard-open_&]:pb-0", sheetClassName)}
        >
          {children}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={popoverClassName} align={align} side={side}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** Scrolling a list is how people dismiss the keyboard on iOS; the search field keeps focus otherwise. */
export const blurOnScroll = () => {
  const el = document.activeElement
  if (el instanceof HTMLElement && el.matches("input, textarea")) el.blur()
}

export function permissionModes(): { value: PermissionMode; label: string; desc: string }[] {
  return [
    { value: "manual", label: t("perm.manual"), desc: t("perm.manual.desc") },
    { value: "acceptEdits", label: t("perm.acceptEdits"), desc: t("perm.acceptEdits.desc") },
    { value: "auto", label: t("perm.auto"), desc: t("perm.auto.desc") },
    { value: "bypass", label: t("perm.bypass"), desc: t("perm.bypass.desc") },
  ]
}

export function PermissionPicker({ value, onChange }: { value: PermissionMode; onChange: (v: PermissionMode) => void }) {
  const modes = permissionModes()
  const cur = modes.find((m) => m.value === value) ?? modes[2]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "gap-1 px-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10",
            value === "bypass" && "text-destructive hover:text-destructive",
          )}
        >
          <span>{cur.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("picker.permission")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PermissionMode)}>
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value} className="items-start py-1.5">
              <div>
                <div>{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.desc}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
