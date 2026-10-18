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
- 移动端：iOS App 是 Mac 上 agent 的遥控器，见下文「移动端」。

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

## 移动端（iOS）

手机不运行 agent：文件、命令、MCP 和模型都留在 Mac 上，iOS App 复用同一套前端，连接已配对 Mac 上的 sidecar。

```
iPhone: WebView 前端 ──invoke/event──▶ Rust 传输层 ──HTTPS/WSS（证书锁定）──▶ Mac: sidecar 远程监听（0.0.0.0:47830）
```

- **开启**：桌面端 设置 → 移动端 → 允许手机连接。sidecar 另开一个 TLS 监听，与桌面窗口用的本机回环接口共享同一套 RPC 与事件。
- **配对**：点「显示配对码」，手机扫码（或粘贴 `kestrel://pair?…` 链接）。二维码里包含候选地址（局域网 IP、Tailscale IP / MagicDNS、`.local`）、端口、证书 SHA-256 指纹和一次性配对码（10 分钟有效、只能用一次、连续猜错 5 次作废）。
- **安全模型**：
  - 自签证书（`<数据目录>/remote/`），手机只认二维码里的指纹，不校验主机名，因此 IP 变化或走 Tailscale 都不影响，网络上的中间人无法冒充 Mac。WebView 做不到证书锁定，所以手机端所有请求都经由 Rust（rustls + ring）发出。
  - 每台手机有独立 token：Mac 只存哈希，手机存钥匙串；可在设置里单独移除（在线连接会被立即断开），或「重置证书」一次性移除全部。
  - 配对后的手机拥有与桌面窗口相同的控制权（经由 agent 执行命令、读写文件）；唯一例外是 `remote.*` 管理接口只允许本机调用。
- **网络**：同一 Wi-Fi 直连；在外面走 Tailscale（见下）。Mac 需开着 Kestrel 且未休眠。
- **地址刷新**：二维码里的地址只是配对时的快照；手机每次连上 Mac 都会通过 `device.hosts` 拉取最新候选地址（Mac 给的排前面，旧地址保留在后，最多 8 个），因此之后再装 Tailscale 或局域网 IP 变化都不用重新配对。

### 在外面使用：Tailscale

Kestrel 不内置 Tailscale，而是在 设置 → 移动端 →「在外面使用」里驱动 Mac 上已安装的 Tailscale（App 包内自带的 CLI、`/usr/local/bin` 或 Homebrew 的 `tailscale`）：未安装 → 打开下载页；已安装未运行 → 启动 App；未登录 → `tailscale login` 并在浏览器打开授权链接；已登录未连接 → `tailscale up`；已连接 → 显示 MagicDNS 名与 IP，并自动加入配对 / 刷新地址。手机端需要另装 Tailscale 并登录同一账号。iOS 同一时间只能开一个 VPN：平时开 Tailscale，在 SideStore 里续签时临时切到 LocalDevVPN。
- **平台分岔点**（业务组件里不出现平台判断）：
  - 传输：`src/lib/api.ts`（桌面 HTTP/WS ↔ 手机原生通道），重连 / 退避 / 回到前台重建连接的策略共用；
  - 平台能力：`src/lib/download.ts`（导出走分享面板、无原生选目录）、`src/lib/platform.ts`；
  - 布局：`PageHeader`、安全区、`pointer-coarse` 触屏适配、`src/lib/viewport.ts`（键盘弹出时跟随可视区域）。

### 构建与安装

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install cocoapods xcodegen
npm run ios:sim      # 模拟器版：src-tauri/gen/apple/build/arm64-sim/Kestrel.app
npm run ios:ipa      # 真机版（未签名）：src-tauri/gen/apple/build/arm64/Kestrel.ipa
```

真机安装：用 SideStore（或 Xcode / Sideloadly 等）导入 `Kestrel.ipa`，它会用你的 Apple ID 重签名。免费 Apple ID 的签名 7 天过期，SideStore 可在手机上续签。

### 已知限制

- 后台推送需要 APNs（付费开发者账号），因此 App 在后台时不会收到审批 / 完成通知；回到前台会自动重连并同步状态。
- iOS 模拟器（iOS 26.3 运行时）本身无法渲染彩色 emoji，真机正常。
