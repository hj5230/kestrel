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
- Providers: Anthropic, OpenAI, Google, DeepSeek, OpenRouter, Amazon Q, Ollama and any OpenAI-compatible service.
- Storage: `~/Library/Application Support/site.hj5230.kestrel/kestrel.db` (`kestrel-dev.db` in development); log at `~/Library/Logs/site.hj5230.kestrel/agent.log`.
- Mobile: the iOS app drives the agent on a paired Mac; see [Mobile](#mobile-ios).

## Features

- Sessions: grouped by time or project, pin, archive, rename, fork, edit and resend, export to Markdown, full-text search (⌘K).
- Chat: streaming output, reasoning, tool-call cards (command output, diffs, subagent progress), image input, steering/queueing, stop, retry.
- Tools: read / write / edit / ls / glob / grep (ripgrep) / bash (with background processes) / web_fetch / web_search (Tavily, only when a key is set in Settings) / todo_write / task (subagents) / ask_user / search_sessions / read_session / skill / memory_search / memory_read / memory_write / memory_delete / MCP.
- Permissions: Manual, Accept edits, Auto and Bypass modes; see [Permissions](#permissions). A denial can carry a reason.
- English and Chinese UI, English by default.
- Context: AGENTS.md / CLAUDE.md loaded level by level, a global instructions file, skills (SKILL.md) and custom `/` commands, auto-compaction with retry on context overflow.
- Memory: Markdown notes in `~/.kestrel/memory/<topic>/<name>.md`, with stable IDs, revisions and source evidence. Configure **both** an embedding endpoint and a Jina-compatible reranker endpoint in Settings → Memory. Every new user message gets a bounded semantic disclosure: up to three full notes, eight related titles, then topics. Tools share this mandatory pipeline; missing configuration disables memory, and service failures never fall back to keyword-only retrieval. A durable background queue extracts useful facts with the session's chat model, validates source quotes, and resumes interrupted saves. Manual management remains available while memory is unavailable. Legacy files are backed up in `.migration-v2` before migration; prior revisions live in `.history`, deleted notes in `.trash`, and vectors in a rebuildable `.index-v2.sqlite` cache. Long inputs use overlapping fixed-size embedding chunks; reranking receives whole notes. No Qdrant service is needed.
- Asking you: with `ask_user` the agent puts multiple-choice questions (single or multi-select, its recommendation first, plus a free-text "Other") to you in a card above the input and waits; it also covers proposals that need a go-ahead. Skip dismisses it and the agent carries on. The question and your answers stay in the transcript. Subagents can't ask; they report back to the agent that launched them.
- Past conversations beyond this app: `search_sessions` / `read_session` also search the sessions that Claude Code (`~/.claude/projects`), Codex (`~/.codex/sessions`) and Cursor (`~/.cursor/projects`) keep on this Mac, read-only. A background index (`history.db` next to Kestrel's database, rebuilt from the originals, incremental after the first pass) holds only what you said and what the assistant answered, not tool output or helper/subagent threads. Turn each app on or off, or rebuild the index, in Settings → Conversation history.
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

## Amazon Q

In **Settings → Models → Add provider**, select **Amazon Q**, enter your API key,
and use its regional service root (normally `https://q.us-east-1.amazonaws.com/`).
Saving discovers and imports the models your key can access. Context windows, output
limits, image support, reasoning efforts and defaults come from the authenticated
model list. Discovery failures are surfaced instead of substituting a static catalog.

The sidecar connects directly through the AI SDK v4 provider interface. It sends
API-key authentication and operation targets to the service root, decodes CRC-checked
AWS EventStream frames, and leaves tools and permissions in Kestrel's agent loop.
System instructions and memory disclosure retain their supplied text. Forced tool
choice and structured-output requests are explicitly unsupported.

The supplied key is sent unchanged as a Bearer token with `tokentype: API_KEY`;
no `ksk_` or other key prefix is required. Existing `kiro` provider configurations
are migrated to `amazon-q` while preserving their IDs, keys, models and sessions.

The endpoint reports credits rather than USD per token. Public model token prices are not applied;
credit metering is available in SDK provider metadata. Missing token counts use Kestrel's
existing, explicitly marked estimate. See [third-party attribution](third-party-notices/amazon-q.md)
for the MIT protocol reference and thinking-parser adaptation.

To independently check discovery and one minimal generation, run
`python3 scripts/check-amazon-q-api.py`; it reads `AMAZON_Q_API_KEY` (or the legacy
`KIRO_API_KEY` variable) or prompts without echoing
the key. Keep credentials out of source files.

## Permissions

Auto mode is the default. It asks as rarely as it safely can, in layers; each call stops at the first layer that can decide:

1. **Always asks a person** (every mode but Bypass): reading credentials (`~/.ssh`, `~/.aws`, Kestrel's own data folder, …), writing startup files, git hooks or the agent's own settings, and deleting or moving `/`, the home folder or a folder directly under either. Paths are resolved through symlinks and compared case-insensitively.
2. **Rules** (no model, no delay): reads and searches; edits inside the working folder; bash commands that a small shell parser (`sidecar/shell.ts`) can read and whose every part is clearly fine: the built-in or your own allowlist (per command, so `cd dir && git status 2>&1 | head` just works), `cd`, redirects into the project or `/dev/null`, `mkdir/touch/cp/mv/rm` inside the project, and wrappers like `timeout` or `nice`. Substitutions, subshells, heredocs and anything unparseable are never matched, and neither are allowlisted commands with flags that write or execute (`find -exec`, `git diff --output`, `rg --pre`, …).
3. **Auto review** (Settings → Permissions → Auto review, needs a review model): everything else — other commands, edits outside the project, MCP tools, fetches with data in the URL — goes to a second model that reads the user's messages and the agent's tool calls, and nothing else, so the agent cannot argue with it and text planted in a page or file never reaches it. It answers ALLOW or BLOCK in two stages (a one-word verdict that leans towards BLOCK, then a short chain of thought only for what was flagged). A block goes back to the agent as the tool result with the reason and an instruction to find a safer way; after 3 blocks in a row, or 20 in a session, a person is asked and auto mode resumes once they approve something. If the review model cannot be reached, a person is asked.
4. **A person**, with the reason shown on the approval card.

Without a review model, step 3 is skipped and unclear calls are asked, so Auto then behaves like the old allowlist mode, minus the unsafe corners. With a review model, allowlist entries that would let any command through (`bash`, `python3`, `npm run`, `rm`, …) are ignored, and are never offered under "Always allow". The policy has three slots you can fill in (trusted environment, extra block rules, exceptions). Auto review is a safety net, not a security boundary; keep sensitive work in Manual mode.

## Local memory models

Install the two runtimes, then run each server in its own terminal:

```sh
brew install ollama llama.cpp
ollama serve
# In another terminal:
ollama pull qwen3-embedding:0.6b
llama-server -hf ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF:Q8_0 \
  --embedding --rerank --pooling rank --host 127.0.0.1 --port 8081 \
  --alias qwen3-reranker-0.6b -c 32768 -b 32768 -ub 32768 -np 1
```

In **Settings → Memory**, choose Ollama for Embedding, enter `http://127.0.0.1:11434/api/embed` with model `qwen3-embedding:0.6b`, and use `http://127.0.0.1:8081/v1/rerank` with model `qwen3-reranker-0.6b` for Reranker. These addresses are accessed by the Mac, including when configured from a phone. Use **Test both models**, then **Save**, and wait for **Memory is ready**. The app does not install or supervise these model servers. Remote endpoints and optional API keys are supported; note content is sent to the endpoints you configure.

Saving the configuration indexes existing notes. **Rebuild index** discards only cached vectors; Markdown remains authoritative. Failed background saves remain visible and can be retried. Turning off automatic saving stops pending work; deleting a note revokes older pending jobs so they cannot recreate forgotten facts. Automatic extraction uses the session model and its usage appears in the session's token/cost totals.

Ollama embedding requests keep the selected model resident with `keep_alive: -1` and allow up to five minutes for a cold load, including Metal shader compilation. Other model requests allow 90 seconds. Warmup and indexing are shared across concurrent callers; stopping one conversation stops its wait, while changing or disabling the memory configuration cancels the shared work. Preparation remains visible in the status panel throughout warmup. A successful connection test of the saved configuration also prepares the index and clears an earlier startup error.

### Retrieval and updates

The system prompt explains the tools. Before each model call, the sidecar matches the latest request (with two preceding user turns for reference resolution), fuses vector and lexical candidates, then reranks up to 40 complete notes. Above the relevance threshold, a roughly 2,000-token budget admits up to three full notes and eight titles, followed by topics. This context is inserted into the latest user message only for inference; it is never copied into the saved conversation or its summary. `memory_search` uses the same pipeline. Long inputs are embedded in overlapping 900-codepoint chunks with a 4,096-token Ollama window, without silently truncating the notes.

Every new main-session user message also creates a durable extraction job. After the foreground run finishes, the session model extracts useful details and merges corrections into retrieved notes. Each automatic write needs an exact quote from that user message. Stable IDs identify the subject; content revisions detect intervening edits; the queue persists a validated write plan before changing files so interrupted jobs can resume. Existing notes retain revision history and source evidence. Automatic extraction currently covers user statements; assistant assertions are not treated as confirmed user facts.

Missing endpoint configuration hides agent memory tools and disclosure. Once configured, a failed retrieval warns and lets the request continue without notes. Failed saves remain queued, retry up to three times, then require **Retry failed saves**. Both models remain mandatory even when there are no notes. The SQLite vector cache avoids an additional database service for this local application. The app permits creating up to 10,000 notes; vector lookup uses an exact scan intended for local collections, not a multi-tenant vector service.

Design references reviewed in October 2026:

- [LangMem](https://github.com/langchain-ai/langmem/blob/main/docs/docs/background_quickstart.md) separates tool-driven writes from background extraction. Kestrel uses a persistent per-turn queue so saving does not depend on the foreground agent choosing a tool.
- [Letta's memory and dreaming](https://docs.letta.com/configuration/memory) combines a versioned memory filesystem with background consolidation. Kestrel keeps editable Markdown and recoverable prior revisions.
- [Mem0's 2026 algorithm](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm) uses multiple retrieval signals and additive facts to retain changes over time. Kestrel combines semantic, lexical and alias signals, while retaining subject-level updates requested by the product; dates, evidence and revision backups protect their history. This is an implementation choice, not a claim of matching Mem0's published benchmark results.
- [Qwen3's model documentation](https://github.com/QwenLM/Qwen3-Embedding), [Ollama's embedding API](https://docs.ollama.com/api/embed), and [llama.cpp's reranking server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) define the tested model and API contracts.

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

Install one or the other, not both: the app and the Homebrew daemon each run their own `tailscaled` and fight over the tunnel.

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
