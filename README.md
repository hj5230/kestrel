# Kestrel

本地 agent 工作台。Tauri 2 桌面壳 + Bun sidecar（agent 运行时）+ Preact/shadcn 前端。

## 架构

```
Tauri (Rust)                 sidecar (Bun, 单文件二进制 kestrel-agent)              前端 (Preact + shadcn)
  启动/守护 sidecar  ──────▶  HTTP RPC + WebSocket 事件 (127.0.0.1:随机端口+token) ◀── fetch / ws
  backend_info 命令           pi-agent-core Agent 循环
  对话框/通知/窗口状态         Vercel AI SDK 适配层 (sidecar/llm/vercel-stream.ts)
                              工具、权限、MCP、技能、压缩、子代理
                              SQLite (bun:sqlite, WAL, FTS5 trigram)
```

- agent 循环用 `@mariozechner/pi-agent-core`；模型调用通过自定义 `streamFn` 走 Vercel AI SDK v7（`ai` + `@ai-sdk/*`），pi 的模型目录只用于补全上下文窗口与单价。
- 供应商：Anthropic、OpenAI、Google、DeepSeek、OpenRouter、Ollama、任意 OpenAI 兼容服务。
- 存储：`~/Library/Application Support/com.zhaoshangqi.kestrel/kestrel.db`（开发模式为 `kestrel-dev.db`），日志 `~/Library/Logs/com.zhaoshangqi.kestrel/agent.log`。

## 功能

- 会话：按时间/项目分组、置顶、归档、重命名、分叉、编辑重发、导出 Markdown、全文检索（⌘K）
- 对话：流式输出、推理过程、工具调用卡片（命令输出、diff、子代理进度）、图片输入、插话/排队、停止、重试
- 工具：read / write / edit / ls / glob / grep(ripgrep) / bash（含后台进程）/ web_fetch / web_search / todo_write / task（子代理）/ search_sessions / read_session / skill / MCP
- 权限：Manual / Accept edits / White list / Bypass 四种模式；bash 白名单（默认内置低风险命令前缀，可在设置里编辑），审批时可一键把命令前缀或 MCP 工具加入白名单，拒绝可附原因
- 界面中英双语，默认英文
- 上下文：AGENTS.md / CLAUDE.md 逐级载入、全局指令文件、技能（SKILL.md）与自定义 `/` 命令、自动压缩与上下文溢出重试
- 用量统计：费用、token、缓存命中、模型排行、工具调用、活跃时段（ECharts）

## 开发

```bash
npm install --registry=https://registry.npmjs.org
npm run sidecar          # 开发 sidecar，固定 127.0.0.1:47821，token=dev
npm run dev              # 浏览器预览前端 http://localhost:1430
npm run tauri dev        # 桌面窗口（debug 构建会用 bun 直接跑 sidecar 源码）
npm run typecheck
```

## 打包

```bash
npm run tauri build -- --bundles app
```

`beforeBuildCommand` 会先构建前端，再用 `bun build --compile` 生成 `src-tauri/binaries/kestrel-agent-<target>`，作为 externalBin 打进 `Kestrel.app`。
