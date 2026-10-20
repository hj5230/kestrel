# Kestrel

A local agent workbench: a Tauri 2 desktop shell, a Bun sidecar that runs the agent, and a Preact/shadcn front end. An iOS app works as a remote control for the agent on your Mac.

## Architecture

```
Tauri (Rust)                  sidecar (Bun, single binary kestrel-agent)                 front end (Preact + shadcn)
  spawns/supervises sidecar ─▶ HTTP RPC + WebSocket events (127.0.0.1:random port+token) ◀── fetch / ws
  backend_info command         pi-agent-core agent loop
  dialogs/notifications/window Vercel AI SDK adapter (sidecar/llm/vercel-stream.ts)
                               tools, permissions, MCP, skills, compaction, subagents
                               SQLite (bun:sqlite, WAL, FTS5 trigram)
```

- The agent loop is `@mariozechner/pi-agent-core`. Model calls go through a custom `streamFn` on the Vercel AI SDK v7 (`ai` + `@ai-sdk/*`); pi's model catalogue only fills in context windows and prices.
- Providers: Anthropic, OpenAI, Google, DeepSeek, OpenRouter, Ollama and any OpenAI-compatible service.
- Storage: `~/Library/Application Support/com.zhaoshangqi.kestrel/kestrel.db` (`kestrel-dev.db` in development); log at `~/Library/Logs/com.zhaoshangqi.kestrel/agent.log`.
- Mobile: the iOS app drives the agent on a paired Mac; see [Mobile](#mobile-ios).

## Features

- Sessions: grouped by time or project, pin, archive, rename, fork, edit and resend, export to Markdown, full-text search (⌘K).
- Chat: streaming output, reasoning, tool-call cards (command output, diffs, subagent progress), image input, steering/queueing, stop, retry.
- Tools: read / write / edit / ls / glob / grep (ripgrep) / bash (with background processes) / web_fetch / web_search / todo_write / task (subagents) / ask_user / search_sessions / read_session / skill / memory_search / memory_read / memory_write / memory_delete / MCP.
- Permissions: Manual, Accept edits, Auto and Bypass modes; see [Permissions](#permissions). A denial can carry a reason.
- English and Chinese UI, English by default.
- Context: AGENTS.md / CLAUDE.md loaded level by level, a global instructions file, skills (SKILL.md) and custom `/` commands, auto-compaction with retry on context overflow.
- Memory: notes the agent keeps across sessions, as Markdown files grouped by topic in `~/.kestrel/memory/<topic>/<name>.md` (types: user, feedback, project, reference). Each session starts with an index of one-line descriptions; the agent opens notes with `memory_read` and can save, replace and delete them itself (deleted notes go to `.trash`; secrets are refused; subagents are read-only). Browse, edit, move and delete them in Settings → Memory, or turn the feature or the agent's own saving off there.
- Asking you: with `ask_user` the agent puts multiple-choice questions (single or multi-select, its recommendation first, plus a free-text "Other") to you in a card above the input and waits; it also covers proposals that need a go-ahead. Skip dismisses it and the agent carries on. The question and your answers stay in the transcript. Subagents can't ask; they report back to the agent that launched them.
- Past conversations beyond this app: `search_sessions` / `read_session` also search the sessions that Claude Code (`~/.claude/projects`), Codex (`~/.codex/sessions`) and Cursor (`~/.cursor/projects`) keep on this Mac, read-only. A background index (`history.db` next to Kestrel's database, rebuilt from the originals, incremental after the first pass) holds only what you said and what the assistant answered, not tool output or helper/subagent threads. Turn each app on or off, or rebuild the index, in Settings → Memory.
- Usage: cost, tokens, cache hits, model ranking, tool calls and active hours (ECharts).

## Development

```bash
npm install --registry=https://registry.npmjs.org
npm run sidecar          # dev sidecar on 127.0.0.1:47821, token=dev
npm run dev              # front end in the browser at http://localhost:1430
npm run tauri dev        # desktop window (debug builds run the sidecar source with bun)
npm run typecheck
```

## Packaging

```bash
npm run tauri build -- --bundles app
```

`beforeBuildCommand` builds the front end, then compiles `src-tauri/binaries/kestrel-agent-<target>` with `bun build --compile`; it ships inside `Kestrel.app` as an externalBin.

## Permissions

Auto mode is the default. It asks as rarely as it safely can, in layers; each call stops at the first layer that can decide:

1. **Always asks a person** (every mode but Bypass): reading credentials (`~/.ssh`, `~/.aws`, Kestrel's own data folder, …), writing startup files, git hooks or the agent's own settings, and deleting or moving `/`, the home folder or a folder directly under either. Paths are resolved through symlinks and compared case-insensitively.
2. **Rules** (no model, no delay): reads and searches; edits inside the working folder; bash commands that a small shell parser (`sidecar/shell.ts`) can read and whose every part is clearly fine: the built-in or your own allowlist (per command, so `cd dir && git status 2>&1 | head` just works), `cd`, redirects into the project or `/dev/null`, `mkdir/touch/cp/mv/rm` inside the project, and wrappers like `timeout` or `nice`. Substitutions, subshells, heredocs and anything unparseable are never matched, and neither are allowlisted commands with flags that write or execute (`find -exec`, `git diff --output`, `rg --pre`, …).
3. **Auto review** (Settings → Permissions → Auto review, needs a review model): everything else — other commands, edits outside the project, MCP tools, fetches with data in the URL — goes to a second model that reads the user's messages and the agent's tool calls, and nothing else, so the agent cannot argue with it and text planted in a page or file never reaches it. It answers ALLOW or BLOCK in two stages (a one-word verdict that leans towards BLOCK, then a short chain of thought only for what was flagged). A block goes back to the agent as the tool result with the reason and an instruction to find a safer way; after 3 blocks in a row, or 20 in a session, a person is asked and auto mode resumes once they approve something. If the review model cannot be reached, a person is asked.
4. **A person**, with the reason shown on the approval card.

Without a review model, step 3 is skipped and unclear calls are asked, so Auto then behaves like the old allowlist mode, minus the unsafe corners. With a review model, allowlist entries that would let any command through (`bash`, `python3`, `npm run`, `rm`, …) are ignored, and are never offered under "Always allow". The policy has three slots you can fill in (trusted environment, extra block rules, exceptions). Auto review is a safety net, not a security boundary; keep sensitive work in Manual mode.

## Mobile (iOS)

The phone does not run the agent. Files, commands, MCP servers and models all stay on the Mac; the iOS app reuses the same front end and connects to the sidecar on a paired Mac.

```
iPhone: WebView front end ──invoke/event──▶ Rust transport ──HTTPS/WSS (pinned cert)──▶ Mac: sidecar remote listener (0.0.0.0:47830)
```

- **Enable**: on the desktop, Settings → Mobile → Allow phones to connect. The sidecar opens a second, TLS listener that shares the RPC and events with the loopback one the desktop window uses.
- **Pair**: click "Show pairing code" and scan it with the phone (or paste the `kestrel://pair?…` link). The QR code carries candidate addresses (LAN IPs, Tailscale IPs / MagicDNS name, `.local`), the port, the certificate's SHA-256 fingerprint and a one-time pairing code (valid 10 minutes, single use, void after 5 wrong guesses).
- **Several Macs**: a phone can stay paired with more than one Mac. Each Mac keeps its own token in the Keychain, and the phone drives one at a time. Switch from the footer of the sidebar or in Settings → Connection, with no new pairing code; "Add another Mac" scans another code without touching the existing pairings. Pairing the same Mac again (same certificate) replaces its entry and removes the old phone record on the Mac, so it is never listed twice.
- **Security model**:
  - A self-signed certificate (`<data dir>/remote/`). The phone trusts only the fingerprint from the QR code and ignores the host name, so changing IPs or going through Tailscale is fine and nobody on the network can impersonate the Mac. A WebView cannot pin certificates, so every request from the phone goes through Rust (rustls + ring).
  - Each phone has its own token: the Mac stores only its hash, the phone keeps it in the Keychain. Phones can be removed one by one in Settings (live connections drop immediately), or all at once with "Reset certificate".
  - A paired phone has the same control as the desktop window (running commands and reading or writing files through the agent). The only exception is the `remote.*` management API, which is local-only.
- **Network**: directly on the same Wi-Fi; away from it, through Tailscale (below). Kestrel must be running on the Mac and the Mac awake. "Stay online with the lid closed" in Settings → Mobile turns system sleep off (`pmset disablesleep`, behind the macOS administrator prompt) so closing the lid only turns the screen off.
- **Address refresh**: the addresses in the QR code are a snapshot. Every time the phone connects it fetches the current candidates through `device.hosts` (the Mac's own first, older ones kept after them, at most 8), so setting up Tailscale later or a new LAN IP never needs re-pairing.

### Away from home: Tailscale

Kestrel does not bundle Tailscale. Settings → Mobile → "Away from home" drives the Tailscale installed on the Mac through its CLI: not installed → open the download page; installed but not running → start the app (or, for the CLI-only install, show how to start the service); not signed in → `tailscale login` with the auth link opened in the browser; signed in but disconnected → `tailscale up`; connected → show the MagicDNS name and IPs, which are added to pairing and address refresh automatically.

The CLI-only install is the lighter option and avoids the macOS network-extension app:

```bash
brew install tailscale
sudo brew services start tailscale
sudo tailscale up
```

The phone needs Tailscale too, signed in to the same account. iOS runs one VPN at a time: keep Tailscale on, and switch to LocalDevVPN only while refreshing apps in SideStore.

### Platform seams

Feature components never branch on platform; the differences live in a few places:

- Transport: `src/lib/api.ts` (desktop HTTP/WS ↔ the phone's native channel), with shared reconnect, backoff and reconnect-on-foreground logic.
- Platform capabilities: `src/lib/download.ts` (exports go through the share sheet, no native folder picker) and `src/lib/platform.ts`.
- Layout: `PageHeader`, safe areas, the touch density layer `src/styles/touch.css` (coarse pointers only), and `src/lib/viewport.ts` (follows the visible area when the keyboard opens).

### Build and install

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install cocoapods xcodegen
npm run ios:sim      # simulator build: src-tauri/gen/apple/build/arm64-sim/Kestrel.app
npm run ios:ipa      # device build (unsigned): src-tauri/gen/apple/build/arm64/Kestrel.ipa
```

To install on a device, import `Kestrel.ipa` with SideStore (or Xcode, Sideloadly, iloader…), which re-signs it with your Apple ID. Free Apple ID signatures expire after 7 days; SideStore can refresh them on the phone.

### Known limitations

- Background push needs APNs (a paid developer account), so the app gets no approval or completion notifications while in the background; it reconnects and syncs when it returns to the foreground.
- The iOS Simulator (iOS 26.3 runtime) cannot render colour emoji; real devices are fine.
