import path from "node:path";
import type { PermissionMode } from "../shared/protocol";
import * as store from "./db";
import type { HelmTool } from "./tools/types";

export interface PermissionResult {
  action: "allow" | "deny" | "ask";
  reason?: string;
  title: string;
  detail: string;
  suggestion: { tool: string; pattern: string } | null;
}

const MULTI_WORD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "cargo", "go", "docker", "kubectl", "brew", "uv", "pip", "pip3", "emo", "make", "gh", "lark-cli", "python", "python3", "node"]);

const SAFE_COMMANDS = [
  /^(ls|pwd|whoami|date|which|type|echo|printf|cat|head|tail|wc|sort|uniq|cut|tr|file|stat|du|df|tree|basename|dirname|realpath|env|printenv|uname|sw_vers|id|true|false)(\s|$)/,
  /^(rg|grep|egrep|fgrep|ag)\s/,
  /^find\s(?!.*(-exec|-delete|-ok|-fprint))/,
  /^git\s+(status|log|diff|show|branch|remote|rev-parse|ls-files|blame|describe|tag|stash list|config --get|reflog|shortlog)(\s|$)/,
  /^(node|bun|python3?|npm|pnpm|cargo|rustc|go|java|tsc)\s+(-v|--version|version)$/,
  /^(npm|pnpm)\s+(ls|list|view|outdated)(\s|$)/,
];

function splitCommand(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasWriteRedirect(cmd: string) {
  return /(^|[^0-9&])>(?!&)|>>|\btee\b/.test(cmd.replace(/2>&1|2>\/dev\/null|>\/dev\/null/g, ""));
}

export function isSafeCommand(cmd: string): boolean {
  if (/[`$]\(|`/.test(cmd) || hasWriteRedirect(cmd)) return false;
  const parts = splitCommand(cmd);
  return parts.length > 0 && parts.every((p) => SAFE_COMMANDS.some((re) => re.test(p)));
}

export function suggestBashPattern(cmd: string): string {
  const first = splitCommand(cmd)[0] ?? cmd;
  const words = first.split(/\s+/).filter((w) => !/^[A-Z_]+=/.test(w));
  if (!words.length) return cmd;
  if (MULTI_WORD.has(words[0]) && words[1] && !words[1].startsWith("-")) return `${words[0]} ${words[1]}:*`;
  return `${words[0]}:*`;
}

function bashMatches(pattern: string, cmd: string): boolean {
  const parts = splitCommand(cmd);
  const matchOne = (c: string) => {
    if (pattern === "*") return true;
    if (pattern.endsWith(":*")) {
      const prefix = pattern.slice(0, -2);
      return c === prefix || c.startsWith(prefix + " ");
    }
    return c === pattern;
  };
  return parts.length > 0 && parts.every(matchOne);
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function pathMatches(pattern: string, file: string, scope: string): boolean {
  const abs = path.resolve(scope === "global" ? "/" : scope, file);
  const base = scope === "global" ? "/" : scope;
  const rel = path.relative(base, abs);
  if (rel.startsWith("..")) return false;
  return globToRegExp(pattern).test(rel || ".");
}

function ruleMatches(tool: HelmTool, args: any, rule: { tool: string; pattern: string; scope: string }, cwd: string): boolean {
  if (rule.scope !== "global" && !(cwd === rule.scope || cwd.startsWith(rule.scope + path.sep))) return false;
  if (rule.tool !== tool.name) {
    if (!(rule.tool === "edit" && tool.name === "write")) return false;
  }
  if (tool.name === "bash") return bashMatches(rule.pattern, String(args?.command ?? ""));
  if (tool.category === "edit") return pathMatches(rule.pattern, String(args?.path ?? ""), rule.scope === "global" ? cwd : rule.scope);
  return rule.pattern === "*" || rule.pattern === tool.name;
}

function describe(tool: HelmTool, args: any): { title: string; detail: string; suggestion: PermissionResult["suggestion"] } {
  if (tool.name === "bash") {
    const cmd = String(args?.command ?? "");
    return {
      title: args?.description ? `执行命令：${args.description}` : "执行命令",
      detail: cmd,
      suggestion: { tool: "bash", pattern: suggestBashPattern(cmd) },
    };
  }
  if (tool.name === "kill_shell") return { title: "结束后台命令", detail: String(args?.shell_id), suggestion: { tool: "kill_shell", pattern: "*" } };
  if (tool.category === "edit") {
    return {
      title: `${tool.name === "write" ? "写入" : "编辑"} ${args?.path ?? ""}`,
      detail: tool.name === "write" ? String(args?.content ?? "").slice(0, 4000) : `- ${String(args?.old_string ?? "").slice(0, 2000)}\n+ ${String(args?.new_string ?? "").slice(0, 2000)}`,
      suggestion: { tool: "edit", pattern: "**" },
    };
  }
  return {
    title: `调用 ${tool.label}`,
    detail: JSON.stringify(args ?? {}, null, 2).slice(0, 4000),
    suggestion: { tool: tool.name, pattern: tool.name },
  };
}

export function evaluatePermission(
  tool: HelmTool,
  args: any,
  mode: PermissionMode,
  cwd: string,
  sessionAllows: { tool: string; pattern: string }[],
): PermissionResult {
  const d = describe(tool, args);
  const res = (action: PermissionResult["action"], reason?: string): PermissionResult => ({ action, reason, ...d });
  if (tool.category === "read" || tool.category === "meta" || tool.category === "network") return res("allow");

  const rules = store.listRules();
  for (const r of rules.filter((r) => r.decision === "deny")) {
    if (ruleMatches(tool, args, r, cwd)) return res("deny", `被权限规则拒绝：${r.tool}(${r.pattern})`);
  }
  if (mode === "plan" && tool.category === "edit") {
    return res("deny", "当前处于只读规划模式，不允许修改文件。请先给出计划，等用户切换模式后再执行修改。");
  }
  if (mode === "bypass") return res("allow");
  if (mode === "acceptEdits" && tool.category === "edit") return res("allow");
  if (tool.name === "bash" && mode !== "plan" && isSafeCommand(String(args?.command ?? ""))) return res("allow");
  for (const r of sessionAllows) if (ruleMatches(tool, args, { ...r, scope: "global" }, cwd)) return res("allow");
  for (const r of rules.filter((r) => r.decision === "allow")) if (ruleMatches(tool, args, r, cwd)) return res("allow");
  return res("ask");
}
