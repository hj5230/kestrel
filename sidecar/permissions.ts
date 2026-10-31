// ---------- what a tool call needs ----------
import type { AppSettings, ApprovalNote, PermissionMode } from "../shared/protocol";
import type { KestrelTool } from "./tools/types";
import { analyzeBash, suggestBashPrefix } from "./permissions/bash";
import { realPath, Paths } from "./permissions/paths";
import { isBroadEntry, toolWhitelisted } from "./permissions/rules";
export { DEFAULT_BASH_WHITELIST, BASH_WHITELIST_ADDED_V2 } from "./permissions/bash-defaults";
export { isBroadEntry, toolWhitelisted } from "./permissions/rules";
export { suggestBashPrefix } from "./permissions/bash";

export interface PermissionResult {
  /**
   * allow  — run it.
   * ask    — a person decides.
   * review — the auto-review model decides (auto mode only; the caller falls back to `ask` when
   *          no review model is set up or the review fails).
   * deny   — never run it.
   */
  action: "allow" | "deny" | "ask" | "review";
  reason?: string;
  /** Why a person is asked, when it is more than "nothing allowed this". */
  note?: ApprovalNote;
  kind: "bash" | "edit" | "tool";
  path: string | null;
  detail: string;
  suggestion: string | null;
}

export interface PermissionContext {
  /** Working directory of the session: the "project" for file edits. */
  cwd: string;
  /** Kestrel's own data directory (database with API keys, certificates). Never touched without asking. */
  dataDir: string;
  /** An auto-review model is configured, so unclear calls can be reviewed instead of asked. */
  reviewer: boolean;
}

// ---------- bash whitelist ----------

// ---------- paths ----------

// ---------- bash analysis ----------

// ---------- decision ----------

const pathArg = (args: any): string | undefined => (typeof args?.path === "string" ? args.path : undefined);

/** A page fetch with nothing in the URL that could carry data out. */
function plainUrl(raw: unknown): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : "https://" + String(raw));
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && !u.search;
  } catch {
    return false;
  }
}

export function evaluatePermission(tool: KestrelTool, args: any, mode: PermissionMode, settings: AppSettings, ctx: PermissionContext): PermissionResult {
  const base = (kind: PermissionResult["kind"], detail: string, suggestion: string | null, path: string | null = null) => ({ kind, detail, suggestion, path });
  let info: Omit<PermissionResult, "action" | "reason">;
  if (tool.name === "bash") {
    const cmd = String(args?.command ?? "");
    info = base("bash", cmd, suggestBashPrefix(cmd));
  } else if (tool.category === "edit") {
    const detail = tool.name === "write" ? String(args?.content ?? "").slice(0, 6000) : "";
    info = base("edit", detail, null, String(args?.path ?? ""));
  } else {
    info = base("tool", JSON.stringify(args ?? {}, null, 2).slice(0, 4000), tool.category === "mcp" ? tool.name : null);
  }
  const res = (action: PermissionResult["action"], extra: { reason?: string; note?: ApprovalNote } = {}): PermissionResult => ({ action, ...extra, ...info });
  // Unclear calls: the reviewer when there is one, otherwise a person.
  const unclear = () => (mode === "auto" && ctx.reviewer ? res("review") : res("ask"));

  if (mode === "bypass") return res("allow");

  const paths = new Paths(ctx.cwd, ctx.dataDir);
  const target = pathArg(args);

  if (tool.category === "meta") return res("allow");
  if (tool.category === "read") {
    if (target !== undefined) {
      const abs = paths.resolve(target);
      if (paths.sensitiveRead(abs)) return res("ask", { note: { code: "sensitive_read", detail: target } });
    }
    return res("allow");
  }
  if (tool.category === "network") {
    if (mode === "auto" && ctx.reviewer && tool.name === "web_fetch" && !plainUrl(args?.url)) return res("review");
    return res("allow");
  }

  if (tool.category === "edit") {
    const abs = paths.resolve(target ?? "");
    const real = realPath(abs);
    if (paths.protectedWrite(abs, real)) return res("ask", { note: { code: "protected_path", detail: target } });
    if (mode === "manual") return res("ask");
    if (paths.inScope(real)) return res("allow");
    return mode === "auto" ? unclear() : res("ask", { note: { code: "outside_project", detail: target } });
  }

  if (mode === "auto") {
    if (tool.name === "kill_shell") return res("allow");
    if (tool.name === "bash") {
      // With a reviewer, rules that allow any command (`bash`, `python3`, `npm run`, …) are ignored so it still sees those.
      const whitelist = ctx.reviewer ? settings.bashWhitelist.filter((e) => !isBroadEntry(e)) : settings.bashWhitelist;
      const v = analyzeBash(String(args?.command ?? ""), ctx, whitelist);
      if (v.level === 0) return res("allow");
      if (v.level === 2) return res("ask", { note: v.note });
      return unclear();
    }
    if (tool.category === "mcp") return toolWhitelisted(tool.name, settings.toolWhitelist) ? res("allow") : unclear();
  }
  return res("ask");
}
