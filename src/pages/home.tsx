import { useEffect, useState } from "preact/hooks"
import { ArrowRightIcon, KeyRoundIcon, ShipWheelIcon } from "lucide-react"
import type { PermissionMode, SessionInfo, ThinkingLevel } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Composer, type Attachment } from "@/components/chat/composer"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker } from "@/components/chat/pickers"
import { rpc } from "@/lib/api"
import { basename, relativeTime, shortPath } from "@/lib/format"
import { appInfo, enabledModels, findModel, openSession, route, sessions, settings } from "@/lib/store"
import { cn } from "@/lib/utils"

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return "夜深了"
  if (h < 12) return "早上好"
  if (h < 18) return "下午好"
  return "晚上好"
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
  const { state: sidebarState } = useSidebar()

  useEffect(() => {
    if (!model.modelId && firstModel) setModel({ providerId: firstModel.providerId, modelId: firstModel.id })
  }, [firstModel?.id])

  const m = findModel(model.providerId, model.modelId)
  const noModels = enabledModels.value.length === 0
  const recent = sessions.value.slice(0, 4)

  const start = async (text: string, images: Attachment[]) => {
    const session = await rpc<SessionInfo>("sessions.create", { cwd, providerId: model.providerId, modelId: model.modelId, thinking, permissionMode: perm })
    openSession(session.id)
    await rpc("chat.send", { sessionId: session.id, text, images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })) })
  }

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className={cn("drag-region flex h-12 shrink-0 items-center px-3", sidebarState === "collapsed" && "pl-20")}>
        <SidebarTrigger className="text-muted-foreground" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6">
        <div className="flex w-full max-w-3xl flex-1 flex-col justify-center pb-[12vh]">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <ShipWheelIcon className="size-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{greeting()}，今天想让 Helm 做点什么？</h1>
            <p className="text-sm text-muted-foreground">在本地目录里读写文件、执行命令、调用技能与 MCP 工具，过程可审批、可追溯。</p>
          </div>
          {noModels ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
              <KeyRoundIcon className="size-6 text-muted-foreground" />
              <div className="text-sm font-medium">还没有可用的模型</div>
              <div className="max-w-sm text-xs text-muted-foreground">添加 Anthropic、OpenAI、Gemini、DeepSeek、OpenRouter、Ollama 或任意 OpenAI 兼容的服务后即可开始。</div>
              <Button onClick={() => (route.value = { name: "settings", tab: "models" })}>
                添加模型供应商
                <ArrowRightIcon />
              </Button>
            </div>
          ) : (
            <Composer
              cwd={cwd}
              autoFocus
              menuBelow
              draftKey="home"
              onSubmit={start}
              placeholder="描述你的任务，例如：梳理这个仓库的构建流程并修复失败的测试"
              toolbar={
                <>
                  <CwdPicker value={cwd} onChange={setCwd} />
                  <PermissionPicker value={perm} onChange={setPerm} />
                  <ModelPicker providerId={model.providerId} modelId={model.modelId} onChange={(providerId, modelId) => setModel({ providerId, modelId })} />
                  {m?.reasoning && <ThinkingPicker value={thinking} onChange={setThinking} />}
                </>
              }
            />
          )}
          {recent.length > 0 && (
            <div className="mt-10">
              <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">最近的会话</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openSession(r.id)}
                    className="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="truncate text-sm font-medium">{r.title || "新会话"}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {basename(r.cwd)} · {relativeTime(r.updatedAt)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
