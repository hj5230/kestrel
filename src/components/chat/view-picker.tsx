import { EyeIcon, ListCollapseIcon, ListIcon, ListTreeIcon, MessageSquareTextIcon } from "lucide-react"
import type { TranscriptView } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { t, type MessageKey } from "@/lib/i18n"
import { settings, updateSettings } from "@/lib/store"
import { toast } from "sonner"

export const VIEWS: { value: TranscriptView; icon: any }[] = [
  { value: "answer", icon: MessageSquareTextIcon },
  { value: "compact", icon: ListCollapseIcon },
  { value: "detailed", icon: ListTreeIcon },
  { value: "verbose", icon: ListIcon },
]

export function ViewPicker() {
  const value = settings.value?.transcriptView ?? "compact"
  const Icon = VIEWS.find((v) => v.value === value)?.icon ?? EyeIcon
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t("view.label")}: {t(`view.${value}` as MessageKey)}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("view.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => updateSettings({ transcriptView: v as TranscriptView }).catch((e) => toast.error(e.message))}
        >
          {VIEWS.map((v) => (
            <DropdownMenuRadioItem key={v.value} value={v.value} className="items-start py-1.5">
              <div>
                <div>{t(`view.${v.value}` as MessageKey)}</div>
                <div className="text-xs text-muted-foreground">{t(`view.${v.value}.desc` as MessageKey)}</div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
