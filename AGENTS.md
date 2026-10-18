# Working on Kestrel

Guidance for coding agents (and people) working in this repository. See README.md for what Kestrel is and how it is built.

## Language

- Everything in the repository is English: code, comments, commit messages, docs, and the default UI language.
- User-facing strings go through i18n and exist in both languages:
  - Front end: `t("key")` with the key added to `src/lib/locales/en.ts` and `src/lib/locales/zh-CN.ts` (the types require both).
  - Sidecar: `sidecar/i18n.ts`.
- Conversations with the maintainer may be in Chinese; that never leaks into the repository.

## Commits

- Small commits, one concern each. Split a change set into several commits rather than one big one.
- Conventional Commits with a scope: `feat(remote): …`, `fix(ui): …`, `docs: …`, `refactor(tauri): …`. The subject is lowercase and says what changed for the user, e.g. `fix(composer): keep send button on screen on narrow widths`.
- A body when the reason isn't obvious: what was wrong and why this fixes it.
- The default branch is `master`. Never push unless asked.
- Run `npm run typecheck` before committing.

## Code style

- Match the surrounding code. The front end (`src/`) has no semicolons; the sidecar (`sidecar/`, `shared/`) uses them. Double quotes everywhere.
- Each module opens with a short comment on what it is for and any non-obvious constraint. Comments explain why, not what.
- Prefer one well-placed abstraction to scattered conditionals. Before adding a branch, look for the seam that already exists (below).

## Architecture rules

- **Three parts, one protocol.** Tauri (Rust) shell, Bun sidecar (agent, tools, SQLite) and the Preact front end. Types shared between the sidecar and the front end live in `shared/protocol.ts`.
- **The phone is a remote control.** The iOS app runs no agent; it talks to the sidecar on a paired Mac through pinned TLS.
  - Every RPC method is reachable from a paired phone unless it is local-only. `remote.*` methods are local-only (`sidecar/server.ts`).
  - Anything that changes pairing, devices, certificates or the Mac's system settings must be `remote.*`.
- **Platform seams.** Feature components never check the platform. The differences live in:
  - `src/lib/platform.ts`: `isMobileApp`, `isDesktopApp`, `isTouch`.
  - `src/lib/api.ts`: transport, HTTP/WS on the desktop and native IPC on the phone.
  - `src/lib/download.ts`, `src/lib/viewport.ts`, `PageHeader`.
- **Desktop stays as it is.** Mobile work must not change the desktop UI.

## UI

- `src/components/ui` is the shadcn kit, sized for a mouse. Don't add touch variants to kit components:
  - Touch sizing lives in `src/styles/touch.css` under `@media (pointer: coarse)`. It matches kit parts by `data-slot`; buttons by the `.group/button` class and sidebar parts by `data-sidebar`, because Radix `asChild` overwrites `data-slot`.
  - One-off touch tweaks at a call site use Tailwind's `pointer-coarse:` variant.
- Touch targets: 44pt for rows and primary controls, 40pt for compact chrome, 16px text in fields (iOS zooms otherwise).
- Prefer an iOS-native feel when it is cheap: bottom sheets for menus on phones, native `<input type="range">`, iOS switch geometry, segmented controls.
- **Preact, not React.** React is aliased to `preact/compat`. Some Radix internals don't work under it; for example, the slider's thumb collection never resolved and the thumb stayed hidden. When a Radix part misbehaves, a native element is usually the better fix.
- Icon-only buttons need an `aria-label`.
- Font stack: PingFang before `-apple-system`, or WKWebView falls back badly for CJK.

## Verifying

- `npm run typecheck` for both the front end and the sidecar.
- For UI changes:
  - Check the desktop window.
  - Check 375pt width with touch emulation in a browser: no horizontal overflow, targets of 44pt or more.
  - Check the iOS Simulator (`npm run ios:sim`).
- Things only a real device can show: the software keyboard, camera scanning, the local-network permission prompt, Tailscale on cellular.
- Report what was and wasn't verified.

## Environment notes

- The Mac reaches the network through a proxy: FlClash in TUN mode, plus `HTTP(S)_PROXY=127.0.0.1:7890`. Addresses in `198.18.0.0/15` are its fake IPs and must never be offered to phones.
- Tailscale on the Mac is the Homebrew CLI daemon (`brew services`), not the app. Kestrel drives either through the `tailscale` CLI.
- iOS device builds are unsigned (`npm run ios:ipa`) and installed with SideStore or iloader, which re-sign them with a free Apple ID.
