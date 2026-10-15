import * as store from "./db";

const en = {
  sessionNotFound: "Session not found",
  dirNotFound: "Folder does not exist: {path}",
  noModel: "No model selected. Add a provider and model in Settings → Models.",
  cwdMissing: "Working folder does not exist: {path}",
  autoCompactFailed: "Auto-compaction failed: {msg}",
  nothingToCompact: "Nothing to compact",
  emptySummary: "The model returned no summary",
  overflowRetry: "Context exceeded the model window — compacting and retrying…",
  approvalExpired: "This approval request is no longer active",
  sessionBusy: "The session is running",
  sessionBusyCompact: "The session is running; compact it once it finishes",
  nothingToRetry: "Nothing to retry",
  onlyUserEdit: "Only user messages can be edited",
  untitled: "New session",
  sessionFallback: "Session",
  forkSuffix: " (fork)",
  providerNotFound: "Model provider not found: {id}",
  configureProvider: "Configure a model provider in Settings first",
  mcpTimeout: "Connection timed out (30s)",
  mcpClosed: "Connection closed",
  exportFolder: "Folder",
  exportModel: "Model",
  exportCreated: "Created",
  exportUser: "User",
  exportAssistant: "Assistant",
  exportToolCall: "Tool call",
  exportError: "Error",
  exportResult: "{tool} result",
  exportResultError: "{tool} result (error)",
  cmdCompact: "Compact context: summarize history to free the context window",
  cmdClear: "Start an empty session with the same folder and model",
  cmdModel: "Switch the model for this session",
  cmdExport: "Export this session as Markdown",
  cmdFork: "Fork a new session from here",
};

type Key = keyof typeof en;

const zh: Record<Key, string> = {
  sessionNotFound: "会话不存在",
  dirNotFound: "目录不存在：{path}",
  noModel: "尚未选择模型。请先在「设置 → 模型」中添加供应商和模型。",
  cwdMissing: "工作目录不存在：{path}",
  autoCompactFailed: "自动压缩失败：{msg}",
  nothingToCompact: "没有可以压缩的内容",
  emptySummary: "模型没有返回摘要",
  overflowRetry: "上下文超出模型窗口，正在压缩后重试…",
  approvalExpired: "该确认请求已失效",
  sessionBusy: "会话正在运行",
  sessionBusyCompact: "会话正在运行，请稍后再压缩",
  nothingToRetry: "没有可以重试的内容",
  onlyUserEdit: "只能编辑用户消息",
  untitled: "新会话",
  sessionFallback: "会话",
  forkSuffix: "（分叉）",
  providerNotFound: "模型供应商不存在：{id}",
  configureProvider: "请先在设置中配置模型供应商",
  mcpTimeout: "连接超时（30 秒）",
  mcpClosed: "连接已断开",
  exportFolder: "目录",
  exportModel: "模型",
  exportCreated: "创建",
  exportUser: "用户",
  exportAssistant: "助手",
  exportToolCall: "工具调用",
  exportError: "错误",
  exportResult: "{tool} 结果",
  exportResultError: "{tool} 结果（错误）",
  cmdCompact: "压缩上下文：总结历史对话以释放上下文窗口",
  cmdClear: "新建一个同目录、同模型的空会话",
  cmdModel: "切换当前会话的模型",
  cmdExport: "导出当前会话为 Markdown",
  cmdFork: "从当前位置分叉出新会话",
};

export function st(key: Key, vars?: Record<string, string | number>): string {
  let lang = "en";
  try {
    lang = store.getSettings().language;
  } catch {}
  const s = (lang === "zh-CN" ? zh : en)[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function dateLocale(): string {
  try {
    return store.getSettings().language === "zh-CN" ? "zh-CN" : "en-US";
  } catch {
    return "en-US";
  }
}
