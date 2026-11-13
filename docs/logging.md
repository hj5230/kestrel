# Logging

How the app records what it does, and the rules that keep the log useful and safe. Read this before adding log calls or touching `src-tauri/src/log/`.

## One writer

The Rust shell is the only code that writes log files. Everything else hands it records.

| Part | How it reports | Source tag |
| --- | --- | --- |
| Rust shell (desktop) | `crate::log::info(...)` | `shell` |
| Rust shell (phone, native network layer) | `crate::log::info(...)` | `phone-native` |
| Bun sidecar | `logger("mod")` prints `KESTREL_LOG <json>` lines on stdout; the shell parses them | `sidecar` |
| Desktop web view | `logger("mod")` in `src/lib/log.ts`, batched into the `log_write` command | `ui` |
| Phone web view | same, on the phone's own shell | `phone` |

The shell also records what no other part can: the sidecar's exit code, crashes and restarts, its raw stdout/stderr
(tagged `sidecar-stdout`, `sidecar-stderr`), and its own panics.

A record cannot claim another source: the shell tags it by the channel it arrived on.

## Records

One JSON object per line: `time` (UTC ISO 8601), `level`, `src`, `mod` (the area), `msg`, optional `fields`.

Levels: `debug` (every request and tool call; only kept in verbose mode), `info` (things that happened), `warn`
(something went wrong and the app coped), `error` (something broke).

Write a message as a fixed phrase ("connection failed") and put the variable parts in `fields`, so records can be searched and counted.

## Files, rotation, retention

Folder: `~/Library/Logs/com.zhaoshangqi.kestrel/` (development builds log to the same place with the dev app's own identifier).

Files are `<tier>-<source>-<YYYY-MM-DD>[.<n>].log`.

| Tier | Holds | Kept |
| --- | --- | --- |
| routine | everything the verbosity allows | 7 days, 128 MB |
| important | warnings and errors only (also written to routine) | 90 days, 64 MB |

- A file rolls over at midnight UTC and at 8 MB.
- A sweep runs at start-up and every 6 hours. It deletes files past their age, then the oldest files while a tier is over its size budget. The files being written are never deleted.
- The old unstructured `agent.log` is removed by the first sweep.
- Verbosity (Settings → About → Logs) is `normal` or `verbose`. The shell keeps it in a `level` file in the log folder so it applies from the first line of the next start. Warnings and errors are never dropped.

## Secrets

Scrubbing happens before a record leaves its origin (`shared/log-redact.ts` for TypeScript, `log/scrub.rs` in the shell, which scrubs everything again).

- Field names that end in `password`, `secret`, `token`, `apikey`, `authorization`, `cookie`, `credentials` or `private_key` are replaced; counts such as `inputTokens` are kept.
- Text is scrubbed for `key=value` pairs, `Bearer` tokens, well-known key prefixes (`sk-`, `tvly-`, `ghp_`…), URL user info and secret query parameters.
- Network records carry host and path only, never the query string.
- Settings changes log key names, not values. Message and file contents are never logged; commands are clipped.
- Strings are cut at 4000 characters, objects at 40 keys, arrays at 20 items, nesting at 4 levels.

## Adding logs

- Sidecar: `const log = logger("area")`, then `log.info("something happened", { sessionId, ms })`. Pass an `Error` as the second argument or as `error` in fields.
- Front end: the same from `@/lib/log`.
- Rust: `crate::log::warn("area", "what happened", json!({ ... }))`.
- Never swallow an error silently. If it is expected and harmless, log it at `debug`.
- Don't log in a tight loop (stream deltas, scroll). Log the start and end.
- Use `log.time(...)` in the sidecar to record how long a step took and that it failed.

## Catching the rest

The sidecar routes `console.*`, Node warnings, `unhandledRejection`, `uncaughtException` and the AI SDK's warnings
(`AI_SDK_LOG_WARNINGS`, each distinct warning once) into the log, and writes the last line before it dies with a
blocking write. The web view records uncaught errors, unhandled rejections, `console.warn/error`, render failures
(the error boundary), going to the background, and the network going away.

## Reading

Settings → About → Logs: view (filter by tier, level, area, text), open the folder, and export a zip to Downloads.

## Verifying

- `npm test` (sidecar logger and scrubbing) and `cargo test --lib log::` in `src-tauri` (names, rollover, retention, scrubbing, ingestion).
- Run the app, do something, and read the folder. A record from each source should appear: `shell`, `sidecar`, `ui`.
