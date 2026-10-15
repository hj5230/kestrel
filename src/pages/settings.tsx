import { useEffect, useMemo, useState } from "preact/hooks"
import { BookTextIcon, CpuIcon, FolderOpenIcon, InfoIcon, PaletteIcon, PlugIcon, RotateCcwIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import type { AppSettings, SkillInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Panel, Row, Section } from "@/components/settings/layout"
import { ModelsSettings } from "@/components/settings/models"
import { McpSettings } from "@/components/settings/mcp"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker, permissionModes } from "@/components/chat/pickers"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { appInfo, enabledModels, providerName, route, settings, updateSettings } from "@/lib/store"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "general", icon: PaletteIcon },
  { key: "models", icon: CpuIcon },
  { key: "mcp", icon: PlugIcon },
  { key: "skills", icon: SparklesIcon },
  { key: "instructions", icon: BookTextIcon },
  { key: "permissions", icon: ShieldCheckIcon },
  { key: "about", icon: InfoIcon },
]

const ACCENTS: { value: AppSettings["accent"]; color: string }[] = [
  { value: "neutral", color: "var(--foreground)" },
  { value: "blue", color: "oklch(0.546 0.245 262.881)" },
  { value: "violet", color: "oklch(0.541 0.281 293.009)" },
  { value: "emerald", color: "oklch(0.596 0.145 163.225)" },
  { value: "orange", color: "oklch(0.646 0.222 41.116)" },
  { value: "rose", color: "oklch(0.586 0.253 17.585)" },
]

function save(patch: Partial<AppSettings>) {
  updateSettings(patch).catch((e) => toast.error(e.message))
}

function BlurInput({ value, onCommit, className, ...rest }: { value: string; onCommit: (v: string) => void; className?: string; [k: string]: any }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <Input {...rest} className={className} value={v} onInput={(e) => setV(e.currentTarget.value)} onBlur={() => v !== value && onCommit(v)} />
}

function LinesEditor({ value, onCommit, placeholder, rows = 3 }: { value: string[]; onCommit: (v: string[]) => void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value.join("\n"))
  useEffect(() => setV(value.join("\n")), [value.join("\n")])
  return (
    <Textarea
      rows={rows}
      value={v}
      placeholder={placeholder}
      className="font-mono text-xs"
      onInput={(e) => setV(e.currentTarget.value)}
      onBlur={() => {
        const next = v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
        if (next.join("\n") !== value.join("\n")) onCommit(next)
      }}
    />
  )
}

function General({ s }: { s: AppSettings }) {
  const titleValue = s.titleModel || "__session"
  return (
    <div className="grid gap-8">
      <Section title={t("settings.appearance")}>
        <Panel>
          <Row label={t("settings.language")}>
            <Select value={s.language} onValueChange={(v) => save({ language: v as AppSettings["language"] })}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh-CN">简体中文</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.theme")}>
            <ToggleGroup type="single" variant="outline" size="sm" value={s.theme} onValueChange={(v) => v && save({ theme: v as any })}>
              <ToggleGroupItem value="system" className="px-3">
                {t("settings.theme.system")}
              </ToggleGroupItem>
              <ToggleGroupItem value="light" className="px-3">
                {t("settings.theme.light")}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="px-3">
                {t("settings.theme.dark")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label={t("settings.accent")}>
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  title={t(`accent.${a.value}` as MessageKey)}
                  onClick={() => save({ accent: a.value })}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-card transition", s.accent === a.value ? "ring-2 ring-ring" : "hover:scale-110")}
                  style={{ background: a.color }}
                />
              ))}
            </div>
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.defaults")} desc={t("settings.defaultsDesc")}>
        <Panel>
          <Row label={t("settings.cwd")}>
            <CwdPicker value={shortPath(s.defaultCwd, appInfo.value?.home)} onChange={(v) => save({ defaultCwd: v })} />
          </Row>
          <Row label={t("settings.model")}>
            <ModelPicker providerId={s.defaultProviderId} modelId={s.defaultModelId} onChange={(p, m) => save({ defaultProviderId: p, defaultModelId: m })} />
          </Row>
          <Row label={t("settings.thinking")} desc={t("settings.thinkingDesc")}>
            <ThinkingPicker value={s.defaultThinking} onChange={(v) => save({ defaultThinking: v })} />
          </Row>
          <Row label={t("settings.permission")}>
            <PermissionPicker value={s.defaultPermissionMode} onChange={(v) => save({ defaultPermissionMode: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.chat")}>
        <Panel>
          <Row label={t("settings.sendKey")}>
            <Select value={s.sendKey} onValueChange={(v) => save({ sendKey: v as any })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enter">{t("settings.sendEnter")}</SelectItem>
                <SelectItem value="mod-enter">{t("settings.sendMod")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.titleModel")} desc={t("settings.titleModelDesc")}>
            <Select value={titleValue} onValueChange={(v) => save({ titleModel: v === "__session" ? "" : v })}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__session">{t("settings.titleSame")}</SelectItem>
                {enabledModels.value.map((m) => (
                  <SelectItem key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                    {m.name} · {providerName(m.providerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.notify")} desc={t("settings.notifyDesc")}>
            <Switch checked={s.notifyOnFinish} onCheckedChange={(v) => save({ notifyOnFinish: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.context")} desc={t("settings.contextDesc")}>
        <Panel>
          <Row label={t("settings.autoCompact")}>
            <Switch checked={s.autoCompact} onCheckedChange={(v) => save({ autoCompact: v })} />
          </Row>
          <Row label={t("settings.threshold")} desc={t("settings.thresholdDesc", { pct: Math.round(s.compactThreshold * 100) })}>
            <Slider
              className="w-48"
              min={50}
              max={95}
              step={5}
              value={[Math.round(s.compactThreshold * 100)]}
              onValueCommit={(v: number[]) => save({ compactThreshold: v[0] / 100 })}
            />
          </Row>
          <Row label={t("settings.keepRecent")} desc={t("settings.keepRecentDesc")}>
            <Select value={String(s.keepRecentTokens)} onValueChange={(v) => save({ keepRecentTokens: Number(v) })}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[8000, 16000, 24000, 40000, 64000].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("settings.keepRecentN", { n: n / 1000 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.exec")}>
        <Panel>
          <Row label={t("settings.bashTimeout")} desc={t("settings.bashTimeoutDesc")}>
            <BlurInput
              type="number"
              className="w-24 text-right"
              value={String(s.bashTimeoutSec)}
              onCommit={(v) => save({ bashTimeoutSec: Math.max(5, Math.min(600, Number(v) || 120)) })}
            />
          </Row>
          <Row label={t("settings.proxy")} desc={t("settings.proxyDesc")}>
            <Select value={s.proxyMode} onValueChange={(v) => save({ proxyMode: v as any })}>
              <SelectTrigger size="sm" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="env">{t("settings.proxy.env")}</SelectItem>
                <SelectItem value="none">{t("settings.proxy.none")}</SelectItem>
                <SelectItem value="custom">{t("settings.proxy.custom")}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          {s.proxyMode === "custom" && (
            <Row label={t("settings.proxyUrl")}>
              <BlurInput className="w-64 font-mono text-xs" placeholder="http://127.0.0.1:7890" value={s.proxyUrl} onCommit={(v) => save({ proxyUrl: v.trim() })} />
            </Row>
          )}
        </Panel>
      </Section>
    </div>
  )
}

function Skills({ s }: { s: AppSettings }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [q, setQ] = useState("")
  useEffect(() => {
    rpc<SkillInfo[]>("skills.list", { cwd: s.defaultCwd }).then(setSkills)
  }, [s.skillDirs.join()])
  const disabled = new Set(s.disabledSkills)
  const shown = useMemo(
    () => (skills ?? []).filter((k) => !q || k.name.toLowerCase().includes(q.toLowerCase()) || k.description.toLowerCase().includes(q.toLowerCase())),
    [skills, q],
  )
  const enabledCount = skills ? skills.filter((k) => !disabled.has(k.name)).length : 0
  return (
    <div className="grid gap-8">
      <Section title={t("settings.skillDirs")} desc={t("settings.skillDirsDesc")}>
        <LinesEditor value={s.skillDirs} onCommit={(v) => save({ skillDirs: v })} />
      </Section>
      <Section title={t("settings.commandDirs")} desc={t("settings.commandDirsDesc")}>
        <LinesEditor value={s.commandDirs} onCommit={(v) => save({ commandDirs: v })} rows={2} />
      </Section>
      <Section
        title={skills ? t("settings.skillsFoundN", { on: enabledCount, all: skills.length }) : t("settings.skillsFound")}
        desc={t("settings.skillsDesc")}
        action={<Input className="w-52" placeholder={t("settings.searchSkills")} value={q} onInput={(e) => setQ(e.currentTarget.value)} />}
      >
        {skills && skills.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle className="text-sm">{t("settings.noSkills")}</EmptyTitle>
              <EmptyDescription>{t("settings.noSkillsDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Panel>
            {shown.map((k) => (
              <Row
                key={k.name}
                label={
                  <span className="flex items-center gap-2">
                    {k.name}
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {k.source}
                    </Badge>
                  </span>
                }
                desc={<span className="line-clamp-2">{k.description}</span>}
              >
                <Switch
                  checked={!disabled.has(k.name)}
                  onCheckedChange={(v) => save({ disabledSkills: v ? s.disabledSkills.filter((n) => n !== k.name) : [...s.disabledSkills, k.name] })}
                />
              </Row>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  )
}

function Instructions({ s }: { s: AppSettings }) {
  const [text, setText] = useState(s.systemPromptAppend)
  useEffect(() => setText(s.systemPromptAppend), [s.systemPromptAppend])
  return (
    <div className="grid gap-8">
      <Section title={t("settings.globalInstructions")} desc={t("settings.globalInstructionsDesc")}>
        <Textarea
          rows={8}
          value={text}
          placeholder={t("settings.globalPlaceholder")}
          onInput={(e) => setText(e.currentTarget.value)}
          onBlur={() => text !== s.systemPromptAppend && save({ systemPromptAppend: text })}
        />
      </Section>
      <Section title={t("settings.instructionFiles")} desc={t("settings.instructionFilesDesc")}>
        <LinesEditor value={s.instructionFiles} onCommit={(v) => save({ instructionFiles: v })} />
      </Section>
      <Section title={t("settings.projectInstructions")}>
        <Panel>
          <Row label={t("settings.loadProject")} desc={t("settings.loadProjectDesc")}>
            <Switch checked={s.loadProjectInstructions} onCheckedChange={(v) => save({ loadProjectInstructions: v })} />
          </Row>
        </Panel>
      </Section>
    </div>
  )
}

function Permissions({ s }: { s: AppSettings }) {
  const restore = async () => {
    const d = await rpc<{ bashWhitelist: string[] }>("permissions.defaults")
    save({ bashWhitelist: d.bashWhitelist })
  }
  return (
    <div className="grid gap-8">
      <Section title={t("settings.defaultMode")} desc={t("settings.alwaysAllowed")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {permissionModes().map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => save({ defaultPermissionMode: m.value })}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:bg-muted/50",
                s.defaultPermissionMode === m.value && "border-primary ring-2 ring-primary/20",
              )}
            >
              <m.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section
        title={`${t("settings.bashWhitelist")} (${s.bashWhitelist.length})`}
        desc={t("settings.bashWhitelistDesc")}
        action={
          <Button variant="outline" size="sm" onClick={restore}>
            <RotateCcwIcon />
            {t("settings.resetDefaults")}
          </Button>
        }
      >
        <LinesEditor value={s.bashWhitelist} onCommit={(v) => save({ bashWhitelist: v })} rows={14} />
      </Section>
      <Section title={t("settings.toolWhitelist")} desc={t("settings.toolWhitelistDesc")}>
        <LinesEditor value={s.toolWhitelist} onCommit={(v) => save({ toolWhitelist: v })} rows={3} placeholder="mcp__server__tool" />
      </Section>
    </div>
  )
}

function About() {
  const info = appInfo.value
  if (!info) return null
  const rows: [string, string][] = [
    [t("settings.version"), info.version + (info.dev ? t("settings.devMode") : "")],
    [t("settings.framework"), "pi-agent-core + Vercel AI SDK"],
    [t("settings.dataDir"), info.dataDir],
    [t("settings.database"), info.dbPath],
    ["Shell", info.shell],
    ["ripgrep", info.ripgrep ? t("settings.rgFound") : t("settings.rgMissing")],
  ]
  return (
    <Section title={t("settings.aboutTitle")} desc={t("settings.aboutDesc")}>
      <Panel>
        {rows.map(([k, v]) => (
          <Row key={k} label={k} desc={<span className="font-mono select-text">{v}</span>} />
        ))}
      </Panel>
      <div>
        <Button variant="outline" size="sm" onClick={() => rpc("app.open", { path: info.dataDir })}>
          <FolderOpenIcon />
          {t("settings.openDataDir")}
        </Button>
      </div>
    </Section>
  )
}

export function SettingsPage({ tab }: { tab?: string }) {
  const current = tab ?? "general"
  const s = settings.value!
  const { state: sidebarState } = useSidebar()
  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className={cn("flex h-12 shrink-0 items-center gap-2 border-b px-3", sidebarState === "collapsed" && "pl-20")}>
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">{t("settings.title")}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-r p-3">
          <div className="grid gap-0.5">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => (route.value = { name: "settings", tab: tb.key })}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  current === tb.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <tb.icon className="size-4" />
                {t(`settings.tab.${tb.key}` as MessageKey)}
              </button>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-8">
            {current === "general" && <General s={s} />}
            {current === "models" && <ModelsSettings />}
            {current === "mcp" && <McpSettings />}
            {current === "skills" && <Skills s={s} />}
            {current === "instructions" && <Instructions s={s} />}
            {current === "permissions" && <Permissions s={s} />}
            {current === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  )
}
