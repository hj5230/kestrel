import * as store from "./db";

const en = {
  memoryDisabled: "Memory is disabled.",
  memoryUnconfigured: "Memory is unavailable. Configure both Embedding and Reranker in Settings → Memory.",
  memoryFailed: "Memory is unavailable ({reason}); answering without notes. Check Settings → Memory.",
  memoryJobFailed: "Automatic memory saving failed: {reason}. Retry it in Settings → Memory.",
  memoryModelTimeout: "Memory model did not respond within {seconds} seconds.",
  sessionNotFound: "Session not found",
  dirNotFound: "Folder does not exist: {path}",
  noModel: "No model selected. Add a provider and model in Settings → Models.",
  cwdMissing: "Working folder does not exist: {path}",
  autoCompactFailed: "Auto-compaction failed: {msg}",
  nothingToCompact: "Nothing to compact",
  emptySummary: "The model returned no summary",
  overflowRetry: "Context exceeded the model window — compacting and retrying…",
  approvalExpired: "This approval request is no longer active",
  questionExpired: "This question is no longer waiting for an answer",
  sessionBusy: "The session is running",
  sessionBusyCompact: "The session is running; compact it once it finishes",
  nothingToRetry: "Nothing to retry",
  onlyUserEdit: "Only user messages can be edited",
  untitled: "New session",
  sessionFallback: "Session",
  nothingToMerge: "This session has nothing new to merge",
  mergeSelf: "A session cannot be merged into itself",
  mergeChanged: "The source changed during merge. Retry to include the latest work.",
  mergeInterrupted: "Merge generation was interrupted by app restart. Retry explicitly.",
  mergedNote: "Merged from another session. No reply is needed until the user asks.",
  providerNotFound: "Model provider not found: {id}",
  configureProvider: "Configure a model provider in Settings first",
  uploadInvalidSession: "Upload target session is invalid",
  uploadMissingFile: "No file was uploaded",
  uploadTooLarge: "File is too large (max 100 MB)",
  uploadInvalidPath: "File path is invalid",
  uploadNotFile: "Selected path is not a file",
  uploadNameExhausted: "Could not allocate a unique upload file name",
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
  ffmpegMissing: "This image format needs ffmpeg. Install it (brew install ffmpeg) or set its path in Settings → Execution & network.",
  imageUnreadable: "The image could not be read",
  imageTooLarge: "The image is too large to send",
};

type Key = keyof typeof en;

const zh: Record<Key, string> = {
  memoryDisabled: "记忆已关闭。",
  memoryUnconfigured: "记忆不可用。请在「设置 → 记忆」中配置 Embedding 和 Reranker 两个模型。",
  memoryFailed: "记忆不可用（{reason}），本次不使用记忆回答。请检查「设置 → 记忆」。",
  memoryJobFailed: "自动保存记忆失败：{reason}。请在「设置 → 记忆」中重试。",
  memoryModelTimeout: "记忆模型未在 {seconds} 秒内响应。",
  sessionNotFound: "会话不存在",
  dirNotFound: "目录不存在：{path}",
  noModel: "尚未选择模型。请先在「设置 → 模型」中添加供应商和模型。",
  cwdMissing: "工作目录不存在：{path}",
  autoCompactFailed: "自动压缩失败：{msg}",
  nothingToCompact: "没有可以压缩的内容",
  emptySummary: "模型没有返回摘要",
  overflowRetry: "上下文超出模型窗口，正在压缩后重试…",
  approvalExpired: "该确认请求已失效",
  questionExpired: "这个问题已不再等待回答",
  sessionBusy: "会话正在运行",
  sessionBusyCompact: "会话正在运行，请稍后再压缩",
  nothingToRetry: "没有可以重试的内容",
  onlyUserEdit: "只能编辑用户消息",
  untitled: "新会话",
  sessionFallback: "会话",
  nothingToMerge: "这个会话没有可合并的新内容",
  mergeSelf: "不能把会话合并到它自己",
  mergeChanged: "来源会话在合并期间发生变化，请重试以包含最新内容。",
  mergeInterrupted: "应用重启中断了合并生成，请手动重试。",
  mergedNote: "这是从另一个会话合并过来的内容，在用户提问前无需回复。",
  providerNotFound: "模型供应商不存在：{id}",
  configureProvider: "请先在设置中配置模型供应商",
  uploadInvalidSession: "上传目标会话无效",
  uploadMissingFile: "未上传文件",
  uploadTooLarge: "文件过大（最大 100 MB）",
  ffmpegMissing: "这种图片格式需要 ffmpeg。请安装（brew install ffmpeg），或在「设置 → 执行与网络」中填写它的路径。",
  imageUnreadable: "无法读取这张图片",
  imageTooLarge: "图片过大，无法发送",
  uploadInvalidPath: "文件路径无效",
  uploadNotFile: "所选路径不是文件",
  uploadNameExhausted: "无法生成唯一的上传文件名",
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
