// Settings > Models: the configured providers with their models, and the dialogs to add or change them.
import { useEffect, useState } from "preact/hooks"
import { PlusIcon, ServerIcon } from "lucide-react"
import { toast } from "sonner"
import type { ModelConfig, ProviderConfig } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Section } from "./layout"
import { rpc } from "@/lib/api"
import { providers } from "@/lib/store"
import { t } from "@/lib/i18n"
import { FetchModelsDialog } from "./fetch-models-dialog"
import { ModelDialog } from "./model-dialog"
import { ProviderDialog, type Presets } from "./provider-dialog"
import { ProviderCard } from "./provider-card"

export function ModelsSettings() {
  const [presets, setPresets] = useState<Presets | null>(null)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editModel, setEditModel] = useState<ModelConfig | null>(null)
  const [fetchFor, setFetchFor] = useState<ProviderConfig | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => {
    rpc<Presets>("providers.presets").then(setPresets)
  }, [])

  const test = async (m: ModelConfig) => {
    const key = `${m.providerId}/${m.id}`
    setTesting(key)
    try {
      const r = await rpc<{ text: string; ms: number }>("providers.test", { providerId: m.providerId, modelId: m.id })
      toast.success(t("models.ok", { name: m.name }), { description: t("models.okDesc", { text: r.text.trim().slice(0, 40), s: (r.ms / 1000).toFixed(1) }) })
    } catch (e: any) {
      toast.error(t("models.failed", { name: m.name }), { description: e.message })
    } finally {
      setTesting(null)
    }
  }

  return (
    <Section
      title={t("models.title")}
      desc={t("models.desc")}
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon />
          {t("models.addProvider")}
        </Button>
      }
    >
      {providers.value.length === 0 && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>{t("models.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("models.emptyDesc")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <PlusIcon />
              {t("models.addProvider")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {providers.value.map((p) => (
        <ProviderCard
          key={p.id}
          p={p}
          presets={presets}
          testing={testing}
          onTest={test}
          onEdit={() => {
            setEditing(p)
            setDialogOpen(true)
          }}
          onFetch={() => setFetchFor(p)}
          onEditModel={setEditModel}
        />
      ))}
      <ProviderDialog open={dialogOpen} provider={editing} presets={presets} onClose={() => setDialogOpen(false)} />
      <ModelDialog model={editModel} onClose={() => setEditModel(null)} />
      <FetchModelsDialog provider={fetchFor} onClose={() => setFetchFor(null)} />
    </Section>
  )
}
