// One provider in Settings > Models: its header (kind, URL, on/off, menu) and its models, each with test, edit,
// remove and an on/off switch. Hover reveals a model's actions with a mouse; touch gets one "…" menu.
import { BrainIcon, CloudDownloadIcon, ImageIcon, MoreHorizontalIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react"
import type { ModelConfig, ProviderConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { rpc } from "@/lib/api"
import { formatTokens } from "@/lib/format"
import { models, refreshProviders } from "@/lib/store"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import type { Presets } from "./provider-dialog"

function ModelRow({ m, testing, onTest, onEdit }: { m: ModelConfig; testing: string | null; onTest: (m: ModelConfig) => void; onEdit: () => void }) {
  return (
    <div className="group/model flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm">{m.name}</span>
          {m.reasoning && <BrainIcon className="size-3.5 text-muted-foreground" />}
          {m.vision && <ImageIcon className="size-3.5 text-muted-foreground" />}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground select-text">
          {m.id} · {t("models.contextN", { n: formatTokens(m.contextWindow) })}
          {m.cost.input || m.cost.output ? t("models.perM", { in: +m.cost.input.toFixed(3), out: +m.cost.output.toFixed(3) }) : ""}
        </div>
      </div>
      {/* Mouse: hover reveals the actions. Touch: one ⋯ menu, so the model name keeps the row. */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/model:opacity-100 pointer-coarse:hidden">
        <Button variant="ghost" size="icon-sm" title={t("models.test")} onClick={() => onTest(m)} disabled={testing !== null}>
          {testing === `${m.providerId}/${m.id}` ? <Spinner /> : <PlayIcon />}
        </Button>
        <Button variant="ghost" size="icon-sm" title={t("common.edit")} onClick={onEdit}>
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("common.remove")}
          onClick={async () => {
            await rpc("models.delete", { providerId: m.providerId, id: m.id })
            refreshProviders()
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      {testing === `${m.providerId}/${m.id}` ? (
        <Spinner className="hidden pointer-coarse:block" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="hidden pointer-coarse:inline-flex" aria-label={t("common.moreActions")} disabled={testing !== null}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onTest(m)}>
              <PlayIcon />
              {t("models.test")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                await rpc("models.delete", { providerId: m.providerId, id: m.id })
                refreshProviders()
              }}
            >
              <Trash2Icon />
              {t("common.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Switch
        checked={m.enabled}
        onCheckedChange={async (v) => {
          await rpc("models.upsert", { ...m, enabled: v })
          refreshProviders()
        }}
      />
    </div>
  )
}

export function ProviderCard({
  p,
  presets,
  testing,
  onTest,
  onEdit,
  onFetch,
  onEditModel,
}: {
  p: ProviderConfig
  presets: Presets | null
  testing: string | null
  onTest: (m: ModelConfig) => void
  onEdit: () => void
  onFetch: () => void
  onEditModel: (m: ModelConfig) => void
}) {
  const list = models.value.filter((m) => m.providerId === p.id)
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", !p.enabled && "opacity-60")}>
      <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-medium">{p.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {presets?.[p.kind]?.name ?? p.kind}
            </Badge>
            {!p.apiKey && presets?.[p.kind]?.needsKey && <Badge variant="destructive" className="text-[10px]">{t("models.missingKey")}</Badge>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground select-text">{p.baseUrl || presets?.[p.kind]?.baseUrl}</div>
        </div>
        {/* Phones: "add models" moves into the ⋯ menu so the name and URL keep their width. */}
        <Button variant="outline" size="sm" className="max-sm:hidden" onClick={onFetch}>
          <CloudDownloadIcon />
          {t("models.addModels")}
        </Button>
        <Switch
          checked={p.enabled}
          onCheckedChange={async (v) => {
            await rpc("providers.upsert", { ...p, enabled: v })
            refreshProviders()
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.moreActions")}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="sm:hidden" onSelect={onFetch}>
              <CloudDownloadIcon />
              {t("models.addModels")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <PencilIcon />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                await rpc("providers.delete", { id: p.id })
                refreshProviders()
              }}
            >
              <Trash2Icon />
              {t("models.deleteProvider")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {list.length === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-muted-foreground">{t("models.noModelsYet")}</div>
      ) : (
        <div className="divide-y">
          {list.map((m) => (
            <ModelRow key={m.id} m={m} testing={testing} onTest={onTest} onEdit={() => onEditModel(m)} />
          ))}
        </div>
      )}
    </div>
  )
}
