// Mobile: which Mac is in use, with a menu to move to another paired Mac or add one.
import { CheckIcon, ChevronsUpDownIcon, LaptopIcon, PlusIcon } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { addingMac, pairedMac, pairedMacs, switchMac } from "@/lib/store"
import { t } from "@/lib/i18n"

/** Mobile: which Mac is in use, with a menu to move to another paired Mac or add one. */
export function MacSwitcher() {
  const { setOpenMobile } = useSidebar()
  const current = pairedMac.value
  if (!current) return null
  const macs = pairedMacs.value.length ? pairedMacs.value : [current]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={t("sidebar.switchMac")} className="-my-1 flex min-w-0 items-center gap-1 rounded-md py-1 pr-1 outline-none active:bg-sidebar-accent">
          <span className="truncate">{current.serverName}</span>
          <ChevronsUpDownIcon className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-52">
        <DropdownMenuLabel>{t("sidebar.switchMac")}</DropdownMenuLabel>
        {macs.map((m) => (
          <DropdownMenuItem
            key={m.deviceId}
            onSelect={() => {
              setOpenMobile(false)
              void switchMac(m.deviceId)
            }}
          >
            <LaptopIcon />
            <span className="truncate">{m.serverName}</span>
            {m.deviceId === current.deviceId && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            setOpenMobile(false)
            addingMac.value = true
          }}
        >
          <PlusIcon />
          {t("connection.add")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
