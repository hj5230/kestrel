import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import {
  BookTextIcon,
  BoxesIcon,
  BrainIcon,
  FolderOpenIcon,
  HistoryIcon,
  InfoIcon,
  LaptopIcon,
  PaletteIcon,
  PlugIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShrinkIcon,
  SmartphoneIcon,
  SparklesIcon,
  TerminalSquareIcon,
  XIcon,
} from "lucide-react"
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
import { PageHeader } from "@/components/page-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Panel, Row, Section } from "@/components/settings/layout"
import { ModelsSettings } from "@/components/settings/models"
import { McpSettings } from "@/components/settings/mcp"
import { HistorySettings, MemorySettings } from "@/components/settings/memory"
import { MobileSettings } from "@/components/settings/mobile"
import { ConnectionSettings } from "@/components/settings/connection"
import { searchSettings } from "@/components/settings/search"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker, permissionModes } from "@/components/chat/pickers"
import { VIEWS } from "@/components/chat/view-picker"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { t, type MessageKey } from "@/lib/i18n"
import { appInfo, enabledModels, providerName, route, settings, updateSettings } from "@/lib/store"
import { isMobileApp, isTouch } from "@/lib/platform"
import { feedbackPrefs, previewSound, setFeedbackPrefs } from "@/lib/feedback"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "general", icon: PaletteIcon },
  { key: "execution", icon: TerminalSquareIcon },
  { key: "automation", icon: ShrinkIcon },
  { key: "models", icon: BoxesIcon },
  { key: "mcp", icon: PlugIcon },
  { key: "skills", icon: SparklesIcon },
  { key: "instructions", icon: BookTextIcon },
  { key: "memory", icon: BrainIcon },
  { key: "history", icon: HistoryIcon },
  { key: "permissions", icon: ShieldCheckIcon },
  // Pairing phones is managed on the Mac; the phone shows which Mac it drives instead.
  ...(!isMobileApp ? [{ key: "mobile", icon: SmartphoneIcon }] : []),
  ...(isMobileApp ? [{ key: "connection", icon: LaptopIcon }] : []),
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
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-card transition pointer-coarse:size-8", s.accent === a.value ? "ring-2 ring-ring" : "hover:scale-110")}
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
            <ThinkingPicker value={s.defaultThinking} choices={enabledModels.value.find((m) => m.providerId === s.defaultProviderId && m.id === s.defaultModelId)?.efforts ?? []} onChange={(v) => save({ defaultThinking: v })} />
          </Row>
          <Row label={t("settings.permission")}>
            <PermissionPicker value={s.defaultPermissionMode} onChange={(v) => save({ defaultPermissionMode: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.chat")}>
        <Panel>
          {/* A software keyboard's return key always inserts a newline; this only applies to hardware keyboards. */}
          {!isTouch && (
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
          )}
          <Row label={t("settings.transcriptView")} desc={t("settings.transcriptViewDesc")}>
            <Select value={s.transcriptView} onValueChange={(v) => save({ transcriptView: v as AppSettings["transcriptView"] })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEWS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {t(`view.${v.value}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label={t("settings.notify")} desc={t("settings.notifyDesc")}>
            <Switch checked={s.notifyOnFinish} onCheckedChange={(v) => save({ notifyOnFinish: v })} />
          </Row>
          <Row label={t("settings.sounds")} desc={t("settings.soundsDesc")}>
            <Switch
              checked={feedbackPrefs.value.sound}
              onCheckedChange={(v) => {
                setFeedbackPrefs({ sound: v })
                if (v) previewSound()
              }}
            />
          </Row>
          {isMobileApp && (
            <Row label={t("settings.haptics")} desc={t("settings.hapticsDesc")}>
              <Switch checked={feedbackPrefs.value.haptics} onCheckedChange={(v) => setFeedbackPrefs({ haptics: v })} />
            </Row>
          )}
        </Panel>
      </Section>
    </div>
  )
}

function Execution({ s }: { s: AppSettings }) {
  return (
    <div className="grid gap-8">
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
          <Row label={t("settings.tavilyKey")} desc={t("settings.tavilyKeyDesc")}>
            <BlurInput
              type="password"
              autoComplete="off"
              spellcheck={false}
              className="w-64 font-mono text-xs"
              placeholder="tvly-…"
              value={s.tavilyApiKey}
              onCommit={(v) => save({ tavilyApiKey: v.trim() })}
            />
          </Row>
        </Panel>
      </Section>
      <Section title={t("settings.media")}>
        <Panel>
          <FfmpegRow s={s} />
        </Panel>
      </Section>
    </div>
  )
}

function FfmpegRow({ s }: { s: AppSettings }) {
  const [status, setStatus] = useState<{ path: string | null; configured: boolean; version: string | null } | null>(null)
  useEffect(() => {
    rpc("media.status").then(setStatus).catch(() => setStatus(null))
  }, [s.ffmpegPath])
  const note = !status ? "" : status.path ? t("settings.ffmpegFound", { path: status.path, version: status.version ?? "?" }) : status.configured ? t("settings.ffmpegBad") : t("settings.ffmpegMissing")
  return (
    <Row
      label={t("settings.ffmpeg")}
      desc={
        <>
          {t("settings.ffmpegDesc")}
          {note && <span className={cn("mt-1 block font-mono text-[11px] break-all", !status?.path && "text-warning")}>{note}</span>}
        </>
      }
    >
      <BlurInput className="w-64 font-mono text-xs" placeholder="/opt/homebrew/bin/ffmpeg" spellcheck={false} value={s.ffmpegPath} onCommit={(v) => save({ ffmpegPath: v.trim() })} />
    </Row>
  )
}

function Automation({ s }: { s: AppSettings }) {
  return (
    <div className="grid gap-8">
      <Section title={t("settings.titleModel")}>
        <Panel>
          <ModelRow label={t("settings.titleModel")} desc={t("settings.titleModelDesc")} value={s.titleModel} none={t("settings.titleSame")} onChange={(v) => save({ titleModel: v })} />
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
          <ModelRow label={t("settings.compactModel")} desc={t("settings.compactModelDesc")} value={s.compactModel} none={t("settings.titleSame")} onChange={(v) => save({ compactModel: v })} />
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

/** A textarea that saves when it loses focus. */
/** A model picker for a background task; an empty value means the `none` choice. */
function ModelRow({ label, desc, value, none, onChange }: { label: string; desc?: string; value: string; none: string; onChange: (v: string) => void }) {
  return (
    <Row label={label} desc={desc}>
      <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{none}</SelectItem>
          {enabledModels.value.map((m) => (
            <SelectItem key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
              {m.name} · {providerName(m.providerId)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

function BlurTextarea({ value, onCommit, placeholder, rows = 3 }: { value: string; onCommit: (v: string) => void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <Textarea rows={rows} value={v} placeholder={placeholder} className="text-sm" onInput={(e) => setV(e.currentTarget.value)} onBlur={() => v.trim() !== value.trim() && onCommit(v.trim())} />
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
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("settings.autoReview")} desc={t("settings.autoReviewDesc")}>
        <Panel>
          <ModelRow label={t("settings.autoModel")} desc={t("settings.autoModelDesc")} value={s.autoModel} none={t("settings.autoModelNone")} onChange={(v) => save({ autoModel: v })} />
        </Panel>
        {(
          [
            ["autoEnvironment", "settings.autoEnvironment", "settings.autoEnvironmentDesc", "settings.autoEnvironmentPlaceholder"],
            ["autoBlockRules", "settings.autoBlock", "settings.autoBlockDesc", "settings.autoBlockPlaceholder"],
            ["autoAllowRules", "settings.autoAllow", "settings.autoAllowDesc", "settings.autoAllowPlaceholder"],
          ] as const
        ).map(([key, title, desc, placeholder]) => (
          <label key={key} className="grid gap-1.5">
            <span className="text-sm font-medium">{t(title)}</span>
            <span className="text-xs text-muted-foreground">{t(desc)}</span>
            <BlurTextarea value={s[key]} onCommit={(v) => save({ [key]: v })} placeholder={t(placeholder)} />
          </label>
        ))}
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
      {!isMobileApp && (
        <div>
          <Button variant="outline" size="sm" onClick={() => rpc("app.open", { path: info.dataDir })}>
            <FolderOpenIcon />
            {t("settings.openDataDir")}
          </Button>
        </div>
      )}
    </Section>
  )
}

export function SettingsPage({ tab }: { tab?: string }) {
  const current = tab ?? "general"
  const s = settings.value!
  // On phones the tabs are a sideways strip: keep the selected one in view.
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" }), [current])
  const [query, setQuery] = useState("")
  const hits = useMemo(() => searchSettings(query, TABS.map((tb) => tb.key)), [query])
  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <span className="text-sm font-medium">{t("settings.title")}</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="shrink-0 border-b md:w-52 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="px-2 pt-2 md:px-3 md:pt-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                aria-label={t("settings.search")}
                placeholder={t("settings.search")}
                className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("")
                  if (e.key === "Enter" && hits[0]) {
                    route.value = { name: "settings", tab: hits[0].tab }
                    setQuery("")
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("common.clear")}
                  className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground pointer-coarse:size-9"
                  onClick={() => setQuery("")}
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          {query ? (
            <div className="grid max-h-[50vh] gap-0.5 overflow-y-auto p-2 md:max-h-none md:p-3">
              {hits.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">{t("settings.noResults")}</div>}
              {hits.map((h) => (
                <button
                  key={`${h.tab}:${h.label}`}
                  type="button"
                  className="grid rounded-lg px-2.5 py-1.5 text-left hover:bg-muted/60 pointer-coarse:min-h-11"
                  onClick={() => {
                    route.value = { name: "settings", tab: h.tab }
                    setQuery("")
                  }}
                >
                  <span className="truncate text-sm">{h.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{t(`settings.tab.${h.tab}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          ) : (
          <div className="flex gap-0.5 overflow-x-auto p-2 [scrollbar-width:none] md:grid md:p-3 [&::-webkit-scrollbar]:hidden">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                ref={current === tb.key ? activeTab : undefined}
                type="button"
                onClick={() => (route.value = { name: "settings", tab: tb.key })}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors pointer-coarse:min-h-10",
                  current === tb.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <tb.icon className="size-4" />
                {t(`settings.tab.${tb.key}` as MessageKey)}
              </button>
            ))}
          </div>
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-8">
            {current === "general" && <General s={s} />}
            {current === "execution" && <Execution s={s} />}
            {current === "automation" && <Automation s={s} />}
            {current === "history" && <HistorySettings s={s} />}
            {current === "models" && <ModelsSettings />}
            {current === "mcp" && <McpSettings />}
            {current === "skills" && <Skills s={s} />}
            {current === "instructions" && <Instructions s={s} />}
            {current === "memory" && <MemorySettings s={s} />}
            {current === "permissions" && <Permissions s={s} />}
            {current === "mobile" && <MobileSettings />}
            {current === "connection" && <ConnectionSettings />}
            {current === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  )
}
