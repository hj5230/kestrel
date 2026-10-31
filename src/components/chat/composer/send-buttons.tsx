// Stop (while running) and send/steer, each a small disc inside a full-size hit area that stays 40pt on touch.
import { ArrowUpIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

const HIT = "group/send rounded-full border-0 p-0 hover:bg-transparent disabled:opacity-100 dark:hover:bg-transparent"
const DISC = "flex size-7 shrink-0 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] group-active/send:scale-95 pointer-coarse:size-8"

export function SendButtons({
  running,
  canSend,
  preparing,
  sendKey,
  onSend,
  onStop,
}: {
  running?: boolean
  canSend: boolean
  /** Pictures are still being converted; sending waits for them. */
  preparing: boolean
  sendKey: "enter" | "mod-enter"
  onSend: () => void
  onStop?: () => void
}) {
  return (
    <div className="mr-2 mb-2.5 flex shrink-0 items-center gap-1.5 pointer-coarse:mb-2">
      {running && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={t("composer.stop")} onClick={onStop} className={HIT}>
              <span className={cn(DISC, "border bg-background text-foreground group-hover/send:bg-muted")}>
                <SquareIcon className="size-2.5! fill-current" />
              </span>
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
            <Button size="icon-sm" variant="ghost" disabled={!canSend} aria-label={running ? t("composer.steer") : t("composer.send")} onClick={onSend} className={HIT}>
              <span
                className={cn(
                  DISC,
                  "bg-foreground text-background shadow-sm group-hover/send:bg-foreground/85",
                  "group-disabled/send:bg-muted-foreground/15 group-disabled/send:text-muted-foreground/60 group-disabled/send:shadow-none",
                )}
              >
                {preparing ? <Spinner className="size-3.5!" /> : <ArrowUpIcon className="size-3.5!" strokeWidth={2.5} />}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {preparing ? t("composer.preparing") : running ? t("composer.steer") : t("composer.send")} {!preparing && <Kbd>{sendKey === "enter" ? "↵" : "⌘↵"}</Kbd>}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
