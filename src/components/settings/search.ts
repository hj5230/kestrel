// What the settings search can find: every setting by the label and help text it shows, in both languages,
// so a query in English finds a setting while the UI is in Chinese and the other way round. Settings that
// live inside a list or dialog (one provider, one MCP server) are reached through their tab's own entry.
import { zhCN } from "@/lib/locales/zh-CN"
import { en, type MessageKey } from "@/lib/locales/en"
import { t } from "@/lib/i18n"

interface Entry {
  tab: string
  label: MessageKey
  desc?: MessageKey
  /** Extra words people search with that the label doesn't contain. */
  also?: string
}

const ENTRIES: Entry[] = [
  { tab: "general", label: "settings.language" },
  { tab: "general", label: "settings.theme", also: "dark light appearance 外观 深色 浅色" },
  { tab: "general", label: "settings.accent", also: "color 颜色" },
  { tab: "general", label: "settings.cwd", also: "folder directory 目录 文件夹" },
  { tab: "general", label: "settings.model", desc: "settings.defaultsDesc" },
  { tab: "general", label: "settings.thinking", desc: "settings.thinkingDesc", also: "effort reasoning 推理" },
  { tab: "general", label: "settings.permission" },
  { tab: "general", label: "settings.sendKey", also: "enter shortcut 快捷键" },
  { tab: "general", label: "settings.transcriptView", desc: "settings.transcriptViewDesc" },
  { tab: "general", label: "settings.notify", desc: "settings.notifyDesc" },
  { tab: "general", label: "settings.sounds", desc: "settings.soundsDesc", also: "audio chime 提示音 音效" },
  { tab: "general", label: "settings.haptics", desc: "settings.hapticsDesc", also: "vibration taptic 震动 振动" },
  { tab: "execution", label: "settings.bashTimeout", desc: "settings.bashTimeoutDesc" },
  { tab: "execution", label: "settings.proxy", desc: "settings.proxyDesc", also: "http https" },
  { tab: "execution", label: "settings.tavilyKey", desc: "settings.tavilyKeyDesc", also: "web search 搜索" },
  { tab: "execution", label: "settings.ffmpeg", desc: "settings.ffmpegDesc", also: "image heic video 图片 视频" },
  { tab: "automation", label: "settings.titleModel", desc: "settings.titleModelDesc" },
  { tab: "automation", label: "settings.autoCompact", desc: "settings.contextDesc" },
  { tab: "automation", label: "settings.threshold" },
  { tab: "automation", label: "settings.compactModel", desc: "settings.compactModelDesc" },
  { tab: "automation", label: "settings.keepRecent", desc: "settings.keepRecentDesc" },
  { tab: "models", label: "models.title", desc: "models.desc", also: "provider api key openrouter openai anthropic 服务商" },
  { tab: "mcp", label: "mcp.title", desc: "mcp.desc" },
  { tab: "skills", label: "settings.skillDirs", desc: "settings.skillDirsDesc" },
  { tab: "skills", label: "settings.commandDirs", desc: "settings.commandDirsDesc", also: "slash 斜杠" },
  { tab: "skills", label: "settings.skillsFound", desc: "settings.skillsDesc" },
  { tab: "instructions", label: "settings.globalInstructions", desc: "settings.globalInstructionsDesc", also: "system prompt 系统提示词" },
  { tab: "instructions", label: "settings.instructionFiles", desc: "settings.instructionFilesDesc", also: "agents.md claude.md" },
  { tab: "instructions", label: "settings.loadProject", desc: "settings.loadProjectDesc" },
  { tab: "memory", label: "memory.enable", desc: "memory.enableDesc" },
  { tab: "memory", label: "memory.autoSave", desc: "memory.autoSaveDesc" },
  { tab: "memory", label: "memory.models", desc: "memory.modelsDesc", also: "embedding reranker" },
  { tab: "memory", label: "memory.notes" },
  { tab: "history", label: "history.title", desc: "history.desc", also: "claude code codex cursor" },
  { tab: "permissions", label: "settings.defaultMode", desc: "settings.alwaysAllowed" },
  { tab: "permissions", label: "settings.autoReview", desc: "settings.autoReviewDesc" },
  { tab: "permissions", label: "settings.autoModel", desc: "settings.autoModelDesc" },
  { tab: "permissions", label: "settings.bashWhitelist", desc: "settings.bashWhitelistDesc", also: "allowlist command 命令" },
  { tab: "permissions", label: "settings.toolWhitelist", desc: "settings.toolWhitelistDesc" },
  { tab: "mobile", label: "mobile.enable", desc: "mobile.enableDesc", also: "phone iphone 手机" },
  { tab: "mobile", label: "mobile.stayAwake", desc: "mobile.stayAwakeDesc", also: "sleep lid 睡眠" },
  { tab: "mobile", label: "mobile.port" },
  { tab: "mobile", label: "mobile.pairTitle", desc: "mobile.pairDesc", also: "qr 二维码" },
  { tab: "mobile", label: "mobile.devices" },
  { tab: "mobile", label: "tailscale.title", desc: "tailscale.desc", also: "vpn remote 远程" },
  { tab: "connection", label: "connection.title" },
  { tab: "about", label: "settings.aboutTitle", desc: "settings.aboutDesc", also: "version data 版本 数据" },
]

const both = (k?: MessageKey) => (k ? `${en[k]} ${zhCN[k]}` : "")

export interface SearchHit {
  tab: string
  label: string
  desc?: string
}

export function searchSettings(query: string, tabs: string[]): SearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return ENTRIES.filter((e) => tabs.includes(e.tab))
    .filter((e) => {
      const hay = `${both(e.label)} ${both(e.desc)} ${e.also ?? ""} ${both(`settings.tab.${e.tab}` as MessageKey)}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .map((e) => ({ tab: e.tab, label: t(e.label), desc: e.desc ? t(e.desc) : undefined }))
}
