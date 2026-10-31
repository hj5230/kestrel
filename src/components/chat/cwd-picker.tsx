// Choosing the working folder: typing a path with completion, recent folders, or the native folder dialog.
import { useEffect, useState } from "preact/hooks"
import { ChevronDownIcon, FolderIcon, FolderOpenIcon, EyeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { rpc } from "@/lib/api"
import { isDesktopApp } from "@/lib/platform"
import { pickDirectory } from "@/lib/download"
import { basename, shortPath } from "@/lib/format"
import { appInfo } from "@/lib/store"
import { t } from "@/lib/i18n"
import { blurOnScroll } from "./pickers"

/** The folder browser itself, so it can sit inside another panel instead of its own popover. */
export function CwdBrowser({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone?: () => void }) {
  const [query, setQuery] = useState("")
  const [recent, setRecent] = useState<string[]>([])
  const [suggest, setSuggest] = useState<string[]>([])
  const home = appInfo.value?.home
  useEffect(() => {
    rpc<string[]>("fs.recentDirs").then(setRecent)
  }, [])
  useEffect(() => {
    if (!query.includes("/") && !query.startsWith("~")) {
      setSuggest([])
      return
    }
    const t = setTimeout(() => rpc<string[]>("fs.dirs", { path: query }).then(setSuggest), 120)
    return () => clearTimeout(t)
  }, [query])
  const choose = (p: string) => {
    onChange(p)
    setQuery("")
    onDone?.()
  }
  return (
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("picker.pathPlaceholder")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80" onTouchMove={blurOnScroll}>
            {query && (
              <CommandGroup heading={t("picker.useTyped")}>
                <CommandItem value={`__typed ${query}`} onSelect={() => choose(query)}>
                  <FolderOpenIcon />
                  <span className="truncate font-mono text-xs">{query}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {suggest.length > 0 && (
              <CommandGroup heading={t("picker.subdirs")}>
                {suggest.map((d) => (
                  <CommandItem key={d} value={`s ${d}`} onSelect={() => setQuery(d + "/")}>
                    <FolderIcon />
                    <span className="truncate font-mono text-xs">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!query && recent.length > 0 && (
              <CommandGroup heading={t("picker.recent")}>
                {recent.map((d) => (
                  <CommandItem key={d} value={`r ${d}`} onSelect={() => choose(d)}>
                    <FolderIcon />
                    <span className="truncate">{basename(d)}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{d}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {isDesktopApp && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__browse"
                    onSelect={async () => {
                      const dir = await pickDirectory(value)
                      if (dir) choose(shortPath(dir, home))
                    }}
                  >
                    <EyeIcon />
                    {t("picker.browse")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
  )
}

export function CwdPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" title={value} className="max-w-60 gap-1 px-2 text-muted-foreground hover:text-foreground">
          <FolderIcon />
          <span className="truncate">{basename(value) || "~"}</span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0" align="start">
        {open && <CwdBrowser value={value} onChange={onChange} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  )
}
