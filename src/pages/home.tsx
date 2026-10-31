import { useEffect, useState } from "preact/hooks"
import { ArrowRightIcon, KeyRoundIcon } from "lucide-react"
import type { PermissionMode, SessionInfo, ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { Composer, type Attachment } from "@/components/chat/composer"
import { ModelControl, PermissionPicker } from "@/components/chat/pickers"
import { rpc, stageAttachments, type StagedFile } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { appInfo, draftKeyForHost, enabledModels, findModel, openSession, route, settings } from "@/lib/store"
import { t, type MessageKey } from "@/lib/i18n"

/** A line that changes each visit, leaning on the time of day half the time. */
function pickGreeting(): string {
  const h = new Date().getHours()
  const part = h >= 5 && h < 12 ? "morning" : h < 18 && h >= 12 ? "afternoon" : h >= 18 && h < 23 ? "evening" : "night"
  const pool = t(Math.random() < 0.5 ? (`home.greet.${part}` as MessageKey) : "home.greet.any").split("|")
  return pool[Math.floor(Math.random() * pool.length)]
}

function Greeting() {
  const [text] = useState(pickGreeting)
  // Letters settle in one after another; the heading itself carries the text for screen readers.
  return (
    <h1 aria-label={text} className="text-2xl font-semibold tracking-tight">
      {[...text].map((ch, i) => (
        <span key={i} aria-hidden="true" className="greet-char" style={{ animationDelay: `${Math.min(i * 22, 600)}ms` }}>
          {ch}
        </span>
      ))}
    </h1>
  )
}

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

  const noModels = enabledModels.value.length === 0

  const start = async (text: string, images: Attachment[], files: StagedFile[]) => {
    const session = await rpc<SessionInfo>("sessions.create", { cwd, providerId: model.providerId, modelId: model.modelId, thinking, permissionMode: perm })
    try {
      const uploaded = await stageAttachments(session.id, files)
      await rpc("chat.send", {
        sessionId: session.id,
        text,
        images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
        files: uploaded,
      })
    } catch (e) {
      await rpc("sessions.delete", { id: session.id }).catch(() => {})
      throw e
    }
    openSession(session.id)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader bordered={false} />
      {/* Reaches under the keyboard, so the greeting stays centred where it was while the keyboard is up. */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 text-center [html.mobile-app_&]:-mb-(--kb)">
        <Greeting />
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
        <div data-keyboard-dock className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0px,calc(var(--safe-bottom)-1.25rem))] md:px-6">
          <Composer
            cwd={cwd}
            autoFocus
            draftKey={draftKeyForHost("home")}
            vision={findModel(model.providerId, model.modelId)?.vision ?? true}
            onSubmit={start}
            placeholder={t("home.placeholder")}
            folder={{ value: cwd, onChange: setCwd }}
            toolbarStart={<PermissionPicker value={perm} onChange={setPerm} />}
            toolbarEnd={
              <ModelControl
                providerId={model.providerId}
                modelId={model.modelId}
                onChange={(providerId, modelId) => setModel({ providerId, modelId })}
                thinking={thinking}
                onThinking={setThinking}
              />
            }
          />
        </div>
      )}
    </div>
  )
}
