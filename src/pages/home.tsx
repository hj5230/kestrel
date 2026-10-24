import { useEffect, useState } from "preact/hooks"
import { ArrowRightIcon, KeyRoundIcon } from "lucide-react"
import type { PermissionMode, SessionInfo, ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { Composer, type Attachment } from "@/components/chat/composer"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker } from "@/components/chat/pickers"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { appInfo, enabledModels, findModel, openSession, route, settings } from "@/lib/store"
import { t } from "@/lib/i18n"

export function HomeView() {
  const s = settings.value!
  const home = appInfo.value?.home
  const firstModel = enabledModels.value[0]
  const [cwd, setCwd] = useState(shortPath(s.defaultCwd, home))
  const [model, setModel] = useState(() => {
    const def = findModel(s.defaultProviderId, s.defaultModelId)
    return def ? { providerId: def.providerId, modelId: def.id } : firstModel ? { providerId: firstModel.providerId, modelId: firstModel.id } : { providerId: "", modelId: "" }
  })
  const [thinking, setThinking] = useState<ThinkingLevel>(s.defaultThinking)
  const [perm, setPerm] = useState<PermissionMode>(s.defaultPermissionMode)

  useEffect(() => {
    if (!model.modelId && firstModel) setModel({ providerId: firstModel.providerId, modelId: firstModel.id })
  }, [firstModel?.id])

  const m = findModel(model.providerId, model.modelId)
  const noModels = enabledModels.value.length === 0

  const start = async (text: string, images: Attachment[]) => {
    const session = await rpc<SessionInfo>("sessions.create", { cwd, providerId: model.providerId, modelId: model.modelId, thinking, permissionMode: perm })
    openSession(session.id)
    await rpc("chat.send", { sessionId: session.id, text, images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })) })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader bordered={false} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("home.headline")}</h1>
        <p className="text-sm text-muted-foreground">{t("home.sub")}</p>
        {noModels && (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
            <KeyRoundIcon className="size-6 text-muted-foreground" />
            <div className="text-sm font-medium">{t("home.noModels")}</div>
            <div className="max-w-sm text-xs text-muted-foreground">{t("home.noModelsDesc")}</div>
            <Button onClick={() => (route.value = { name: "settings", tab: "models" })}>
              {t("home.addProvider")}
              <ArrowRightIcon />
            </Button>
          </div>
        )}
      </div>
      {!noModels && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0.75rem,var(--safe-bottom))] md:px-6 md:pb-5">
          <Composer
            cwd={cwd}
            autoFocus
            draftKey="home"
            onSubmit={start}
            placeholder={t("home.placeholder")}
            toolbar={
              <>
                <CwdPicker value={cwd} onChange={setCwd} />
                <PermissionPicker value={perm} onChange={setPerm} />
                <ModelPicker providerId={model.providerId} modelId={model.modelId} onChange={(providerId, modelId) => setModel({ providerId, modelId })} />
                {m?.reasoning && <ThinkingPicker value={thinking} onChange={setThinking} />}
              </>
            }
          />
        </div>
      )}
    </div>
  )
}
