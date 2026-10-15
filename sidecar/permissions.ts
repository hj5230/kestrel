import type { AppSettings, PermissionMode } from "../shared/protocol";
import type { KestrelTool } from "./tools/types";

export const DEFAULT_BASH_WHITELIST = [
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "echo",
  "printf",
  "which",
  "whereis",
  "type",
  "whoami",
  "id",
  "date",
  "uname",
  "sw_vers",
  "hostname",
  "uptime",
  "printenv",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
  "md5",
  "shasum",
  "jq",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "find",
  "fd",
  "ps",
  "lsof",
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch --show-current",
  "git branch -a",
  "git branch --list",
  "git remote -v",
  "git rev-parse",
  "git ls-files",
  "git blame",
  "git describe",
  "git stash list",
  "git shortlog",
  "git reflog",
  "git config --get",
  "node --version",
  "node -v",
  "npm --version",
  "npm -v",
  "npm ls",
  "npm list",
  "npm view",
  "npm outdated",
  "pnpm --version",
  "pnpm ls",
  "bun --version",
  "python3 --version",
  "python --version",
  "cargo --version",
  "rustc --version",
  "go version",
  "tsc --version",
];

export interface PermissionResult {
  action: "allow" | "deny" | "ask";
  reason?: string;
  kind: "bash" | "edit" | "tool";
  path: string | null;
  detail: string;
  suggestion: string | null;
}

const MULTI_WORD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "cargo", "go", "docker", "kubectl", "brew", "uv", "pip", "pip3", "emo", "make", "gh", "lark-cli", "python", "python3", "node", "deno"]);
const RUN_WORD = new Set(["run", "exec", "x"]);

export function splitCommand(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim().replace(/^(\w+=\S*\s+)+/, ""))
    .filter(Boolean);
}

function hasUnsafeSyntax(cmd: string): boolean {
  const stripped = cmd.replace(/2>&1|[12]?>\s*\/dev\/null/g, "");
  return /\$\(|`|<\(|>|\btee\b/.test(stripped);
}

function hasDangerousFlags(segment: string): boolean {
  return /^find\s/.test(segment) && /\s-(exec|execdir|delete|ok|fprint|fls)\b/.test(segment);
}

function normalizeEntry(e: string): string {
  return e.trim().replace(/(:\*|\s\*)$/, "").trim();
}

function segmentMatches(segment: string, entry: string): boolean {
  const e = normalizeEntry(entry);
  if (!e) return false;
  return segment === e || segment.startsWith(e + " ");
}

export function bashWhitelisted(cmd: string, whitelist: string[]): boolean {
  if (!cmd.trim() || hasUnsafeSyntax(cmd)) return false;
  const parts = splitCommand(cmd);
  return parts.length > 0 && parts.every((p) => !hasDangerousFlags(p) && whitelist.some((e) => segmentMatches(p, e)));
}

export function toolWhitelisted(name: string, whitelist: string[]): boolean {
  return whitelist.some((e) => {
    const v = e.trim();
    if (!v) return false;
    if (v.endsWith("*")) return name.startsWith(v.slice(0, -1));
    return v === name;
  });
}

export function suggestBashPrefix(cmd: string): string {
  const first = splitCommand(cmd)[0] ?? cmd.trim();
  const words = first.split(/\s+/);
  if (!words.length) return first;
  if (MULTI_WORD.has(words[0]) && words[1] && !words[1].startsWith("-")) {
    if (RUN_WORD.has(words[1]) && words[2] && !words[2].startsWith("-")) return words.slice(0, 3).join(" ");
    return words.slice(0, 2).join(" ");
  }
  return words[0];
}

export function evaluatePermission(tool: KestrelTool, args: any, mode: PermissionMode, settings: AppSettings): PermissionResult {
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
  const res = (action: PermissionResult["action"], reason?: string): PermissionResult => ({ action, reason, ...info });

  if (tool.category === "read" || tool.category === "meta" || tool.category === "network") return res("allow");
  if (mode === "bypass") return res("allow");
  if (tool.category === "edit") return mode === "manual" ? res("ask") : res("allow");
  if (mode === "whitelist") {
    if (tool.name === "bash" && bashWhitelisted(String(args?.command ?? ""), settings.bashWhitelist)) return res("allow");
    if (tool.name === "kill_shell") return res("allow");
    if (tool.category === "mcp" && toolWhitelisted(tool.name, settings.toolWhitelist)) return res("allow");
  }
  return res("ask");
}
