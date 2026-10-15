import { useEffect, useMemo, useState } from "preact/hooks"
import {
  BookTextIcon,
  CpuIcon,
  FolderOpenIcon,
  InfoIcon,
  PaletteIcon,
  PlugIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Trash2Icon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { AppSettings, PermissionRule, SkillInfo } from "@shared/protocol"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Panel, Row, Section } from "@/components/settings/layout"
import { ModelsSettings } from "@/components/settings/models"
import { McpSettings } from "@/components/settings/mcp"
import { CwdPicker, ModelPicker, PermissionPicker, ThinkingPicker, PERMISSION_MODES } from "@/components/chat/pickers"
import { rpc } from "@/lib/api"
import { shortPath } from "@/lib/format"
import { appInfo, enabledModels, providerName, route, settings, updateSettings } from "@/lib/store"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "general", label: "通用", icon: PaletteIcon },
  { key: "models", label: "模型", icon: CpuIcon },
  { key: "mcp", label: "MCP 服务", icon: PlugIcon },
  { key: "skills", label: "技能与命令", icon: SparklesIcon },
  { key: "instructions", label: "指令", icon: BookTextIcon },
  { key: "permissions", label: "权限", icon: ShieldCheckIcon },
  { key: "about", label: "关于", icon: InfoIcon },
]

const ACCENTS: { value: AppSettings["accent"]; color: string; label: string }[] = [
  { value: "neutral", color: "var(--foreground)", label: "石墨" },
  { value: "blue", color: "oklch(0.546 0.245 262.881)", label: "蓝" },
  { value: "violet", color: "oklch(0.541 0.281 293.009)", label: "紫" },
  { value: "emerald", color: "oklch(0.596 0.145 163.225)", label: "绿" },
  { value: "orange", color: "oklch(0.646 0.222 41.116)", label: "橙" },
  { value: "rose", color: "oklch(0.586 0.253 17.585)", label: "玫红" },
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
        const next = v.split("\n").map((s) => s.trim()).filter(Boolean)
        if (next.join("\n") !== value.join("\n")) onCommit(next)
      }}
    />
  )
}

function General({ s }: { s: AppSettings }) {
  const titleValue = s.titleModel || "__session"
  return (
    <div className="grid gap-8">
      <Section title="外观">
        <Panel>
          <Row label="主题">
            <ToggleGroup type="single" variant="outline" size="sm" value={s.theme} onValueChange={(v) => v && save({ theme: v as any })}>
              <ToggleGroupItem value="system" className="px-3">跟随系统</ToggleGroupItem>
              <ToggleGroupItem value="light" className="px-3">浅色</ToggleGroupItem>
              <ToggleGroupItem value="dark" className="px-3">深色</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="强调色">
            <div className="flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  title={a.label}
                  onClick={() => save({ accent: a.value })}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-card transition", s.accent === a.value ? "ring-2 ring-ring" : "hover:scale-110")}
                  style={{ background: a.color }}
                />
              ))}
            </div>
          </Row>
        </Panel>
      </Section>
      <Section title="新会话默认值" desc="在首页创建会话时使用；每个会话可以单独修改。">
        <Panel>
          <Row label="工作目录">
            <CwdPicker value={shortPath(s.defaultCwd, appInfo.value?.home)} onChange={(v) => save({ defaultCwd: v })} />
          </Row>
          <Row label="模型">
            <ModelPicker providerId={s.defaultProviderId} modelId={s.defaultModelId} onChange={(p, m) => save({ defaultProviderId: p, defaultModelId: m })} />
          </Row>
          <Row label="推理强度" desc="仅对支持推理的模型生效">
            <ThinkingPicker value={s.defaultThinking} onChange={(v) => save({ defaultThinking: v })} />
          </Row>
          <Row label="权限模式">
            <PermissionPicker value={s.defaultPermissionMode} onChange={(v) => save({ defaultPermissionMode: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title="对话">
        <Panel>
          <Row label="发送快捷键">
            <Select value={s.sendKey} onValueChange={(v) => save({ sendKey: v as any })}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enter">Enter 发送</SelectItem>
                <SelectItem value="mod-enter">⌘ + Enter 发送</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="标题生成模型" desc="为新会话自动生成标题">
            <Select value={titleValue} onValueChange={(v) => save({ titleModel: v === "__session" ? "" : v })}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__session">与会话模型相同</SelectItem>
                {enabledModels.value.map((m) => (
                  <SelectItem key={`${m.providerId}::${m.id}`} value={`${m.providerId}::${m.id}`}>
                    {m.name} · {providerName(m.providerId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="完成时通知" desc="窗口不在前台时，任务完成或需要确认会发送系统通知">
            <Switch checked={s.notifyOnFinish} onCheckedChange={(v) => save({ notifyOnFinish: v })} />
          </Row>
        </Panel>
      </Section>
      <Section title="上下文管理" desc="长会话接近模型上下文窗口时，自动把较早的对话总结成摘要，保留最近的内容。">
        <Panel>
          <Row label="自动压缩">
            <Switch checked={s.autoCompact} onCheckedChange={(v) => save({ autoCompact: v })} />
          </Row>
          <Row label="触发阈值" desc={`上下文占用超过 ${Math.round(s.compactThreshold * 100)}% 时压缩`}>
            <Slider
              className="w-48"
              min={50}
              max={95}
              step={5}
              value={[Math.round(s.compactThreshold * 100)]}
              onValueCommit={(v: number[]) => save({ compactThreshold: v[0] / 100 })}
            />
          </Row>
          <Row label="保留最近内容" desc="压缩时原样保留的最近对话量">
            <Select value={String(s.keepRecentTokens)} onValueChange={(v) => save({ keepRecentTokens: Number(v) })}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[8000, 16000, 24000, 40000, 64000].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    约 {n / 1000}k tokens
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Panel>
      </Section>
      <Section title="执行与网络">
        <Panel>
          <Row label="命令超时" desc="bash 工具单次执行的默认超时（秒）">
            <BlurInput type="number" className="w-24 text-right" value={String(s.bashTimeoutSec)} onCommit={(v) => save({ bashTimeoutSec: Math.max(5, Math.min(600, Number(v) || 120)) })} />
          </Row>
          <Row label="网络代理" desc="用于访问模型 API、网页抓取与远程 MCP；本机地址始终直连">
            <Select value={s.proxyMode} onValueChange={(v) => save({ proxyMode: v as any })}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="env">跟随 shell 环境变量</SelectItem>
                <SelectItem value="none">不使用代理</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          {s.proxyMode === "custom" && (
            <Row label="代理地址">
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
  return (
    <div className="grid gap-8">
      <Section title="技能目录" desc="每个子目录包含一个 SKILL.md（兼容 Claude Code / Agent Skills 格式）。项目内的 .helm/skills、.claude/skills、.agents/skills 也会被加载。">
        <LinesEditor value={s.skillDirs} onCommit={(v) => save({ skillDirs: v })} />
      </Section>
      <Section title="自定义命令目录" desc="目录中的 .md 文件会成为 / 命令，支持 $ARGUMENTS 占位符。项目内的 .claude/commands 也会被加载。">
        <LinesEditor value={s.commandDirs} onCommit={(v) => save({ commandDirs: v })} rows={2} />
      </Section>
      <Section
        title={`已发现的技能${skills ? `（${skills.length - disabled.size} / ${skills.length} 启用）` : ""}`}
        desc="启用的技能会以名称和描述列在系统提示词中，模型按需加载全文。技能很多时可以关掉用不到的以节省上下文。"
        action={<Input className="w-52" placeholder="搜索技能…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />}
      >
        {skills && skills.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle className="text-sm">没有找到技能</EmptyTitle>
              <EmptyDescription>在上面的目录中放入技能后会自动出现。</EmptyDescription>
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
      <Section title="全局指令" desc="追加到每个会话的系统提示词中，例如回复语言、工作习惯、代码风格偏好。">
        <Textarea
          rows={8}
          value={text}
          placeholder={"例如：\n- 永远用中文回复\n- 改代码前先说明改动范围\n- 声称完成前先跑构建或测试自证"}
          onInput={(e) => setText(e.currentTarget.value)}
          onBlur={() => text !== s.systemPromptAppend && save({ systemPromptAppend: text })}
        />
      </Section>
      <Section title="指令文件" desc="这些文件的内容会作为用户指令载入（不存在的文件会被跳过）。一行一个路径。">
        <LinesEditor value={s.instructionFiles} onCommit={(v) => save({ instructionFiles: v })} />
      </Section>
      <Section title="项目指令">
        <Panel>
          <Row label="自动载入项目指令" desc="从工作目录向上查找 AGENTS.md / CLAUDE.md 并载入（到主目录为止）">
            <Switch checked={s.loadProjectInstructions} onCheckedChange={(v) => save({ loadProjectInstructions: v })} />
          </Row>
        </Panel>
      </Section>
    </div>
  )
}

function Permissions({ s }: { s: AppSettings }) {
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [tool, setTool] = useState("bash")
  const [pattern, setPattern] = useState("")
  const [decision, setDecision] = useState<"allow" | "deny">("allow")
  const load = () => rpc<PermissionRule[]>("rules.list").then(setRules)
  useEffect(() => {
    load()
  }, [])
  const add = async (e: Event) => {
    e.preventDefault()
    if (!pattern.trim()) return
    await rpc("rules.add", { tool, pattern: pattern.trim(), decision, scope: "global" })
    setPattern("")
    load()
  }
  return (
    <div className="grid gap-8">
      <Section title="默认权限模式">
        <div className="grid gap-2 sm:grid-cols-2">
          {PERMISSION_MODES.map((m) => (
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
        <p className="text-xs text-muted-foreground">读取类工具（read、grep、glob、网页搜索等）与只读命令（ls、git status、rg 等）始终直接执行。</p>
      </Section>
      <Section title="权限规则" desc="审批时选择「此项目始终允许」会自动写入规则。bash 规则支持前缀匹配，如 npm run:*；编辑规则支持路径 glob，如 src/**。">
        <form onSubmit={add} className="flex gap-2">
          <Select value={tool} onValueChange={setTool}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bash">bash</SelectItem>
              <SelectItem value="edit">edit</SelectItem>
              <SelectItem value="kill_shell">kill_shell</SelectItem>
            </SelectContent>
          </Select>
          <Input className="flex-1 font-mono text-xs" placeholder={tool === "bash" ? "npm test:*" : "src/**"} value={pattern} onInput={(e) => setPattern(e.currentTarget.value)} />
          <Select value={decision} onValueChange={(v) => setDecision(v as any)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">允许</SelectItem>
              <SelectItem value="deny">拒绝</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            <PlusIcon />
            添加
          </Button>
        </form>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">工具</TableHead>
                <TableHead>匹配</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>决定</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                    暂无规则
                  </TableCell>
                </TableRow>
              )}
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 font-mono text-xs">{r.tool}</TableCell>
                  <TableCell className="font-mono text-xs">{r.pattern}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={r.scope}>
                    {r.scope === "global" ? "全局" : shortPath(r.scope, appInfo.value?.home)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.decision === "allow" ? "secondary" : "destructive"}>{r.decision === "allow" ? "允许" : "拒绝"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={async () => {
                        await rpc("rules.delete", { id: r.id })
                        load()
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  )
}

function About() {
  const info = appInfo.value
  if (!info) return null
  const rows: [string, string][] = [
    ["版本", info.version + (info.dev ? "（开发模式）" : "")],
    ["Agent 框架", "pi-agent-core + Vercel AI SDK"],
    ["数据目录", info.dataDir],
    ["数据库", info.dbPath],
    ["Shell", info.shell],
    ["ripgrep", info.ripgrep ? "已找到" : "未安装（grep 工具将使用系统 grep）"],
  ]
  return (
    <Section title="关于 Helm" desc="本地优先的通用 agent 工作台：所有会话、配置与密钥都保存在这台电脑上。">
      <Panel>
        {rows.map(([k, v]) => (
          <Row key={k} label={k} desc={<span className="font-mono">{v}</span>} />
        ))}
      </Panel>
      <div>
        <Button variant="outline" size="sm" onClick={() => rpc("app.open", { path: info.dataDir })}>
          <FolderOpenIcon />
          打开数据目录
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
      <header data-tauri-drag-region className={cn("drag-region flex h-12 shrink-0 items-center gap-2 border-b px-3", sidebarState === "collapsed" && "pl-20")}>
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">设置</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="w-48 shrink-0 border-r p-3">
          <div className="grid gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => (route.value = { name: "settings", tab: t.key })}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  current === t.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <t.icon className="size-4" />
                {t.label}
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
