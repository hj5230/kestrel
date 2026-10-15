import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionMode } from "../../shared/protocol";
import * as store from "../db";
import { collapseHome, expandHome, HOME, SHELL } from "../env";
import { discoverSkills } from "../skills";

export interface InstructionFile {
  path: string;
  content: string;
  scope: "global" | "project";
}

const PROJECT_FILES = ["AGENTS.md", "CLAUDE.md", "AGENT.md"];

export function collectInstructions(cwd: string): InstructionFile[] {
  const settings = store.getSettings();
  const out: InstructionFile[] = [];
  const seen = new Set<string>();
  const add = (p: string, scope: InstructionFile["scope"]) => {
    const real = (() => {
      try {
        return fs.realpathSync(p);
      } catch {
        return null;
      }
    })();
    if (!real || seen.has(real)) return;
    try {
      const content = fs.readFileSync(real, "utf8").trim();
      if (!content) return;
      seen.add(real);
      out.push({ path: p, content: content.slice(0, 60000), scope });
    } catch {}
  };
  for (const f of settings.instructionFiles) add(expandHome(f), "global");
  if (settings.loadProjectInstructions) {
    const chain: string[] = [];
    let dir = path.resolve(cwd);
    while (true) {
      chain.unshift(dir);
      const parent = path.dirname(dir);
      if (parent === dir || dir === HOME) break;
      dir = parent;
    }
    for (const d of chain) {
      if (d === HOME) continue;
      for (const name of PROJECT_FILES) {
        const p = path.join(d, name);
        if (fs.existsSync(p)) {
          add(p, "project");
          break;
        }
      }
    }
  }
  return out;
}

function gitInfo(cwd: string): string {
  try {
    const r = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    if (r.exitCode !== 0) return "no";
    const branch = r.stdout.toString().trim();
    const st = Bun.spawnSync(["git", "-C", cwd, "status", "--porcelain"], { stdout: "pipe", stderr: "ignore" });
    const dirty = st.stdout.toString().trim().split("\n").filter(Boolean).length;
    return `yes (branch ${branch}${dirty ? `, ${dirty} changed files` : ", clean"})`;
  } catch {
    return "unknown";
  }
}

const BASE = `You are Helm, a capable general-purpose agent running locally on the user's computer. You help with software engineering, research, data work, writing and everyday computer tasks by reasoning carefully and using tools.

# How to work
- Understand the request first. For non-trivial tasks, explore the relevant files/context before acting; read several files in parallel when useful.
- Use todo_write to plan and track multi-step work (3+ steps); keep it updated as you go.
- Make changes with the edit/write tools rather than shell redirection. Read a file before editing it. Keep edits minimal and in the style of the surrounding code; do not refactor unrelated code.
- Verify your work: run builds, tests, linters or the program itself when possible, and report results faithfully. Never claim success you have not checked; if something failed or was skipped, say so.
- Paths written as @path in user messages refer to files relative to the working directory; read them when relevant.
- Prefer the dedicated read/grep/glob/ls tools over shell equivalents. Run independent tool calls in parallel.
- Use the task tool to delegate broad, self-contained investigations to a subagent and keep your own context focused.
- When the user refers to earlier work or conversations, use search_sessions and read_session to recover that context instead of guessing.
- When a skill in the list below matches the task, load it with the skill tool before starting and follow it.
- If a request is ambiguous and getting it wrong would be costly (deleting data, large rewrites, outward-facing actions), stop and ask a concise question instead of guessing.
- Be careful with destructive or irreversible commands (rm -rf, git reset --hard, force push, dropping data). Never run them unless clearly requested.
- Do not commit or push with git unless asked.

# Communication
- Reply in the language the user writes in.
- Be direct and concise. Lead with the answer or result, then the essential supporting detail. Use Markdown; use fenced code blocks with a language tag for code.
- Reference files as path:line so they are easy to locate.
- After finishing a task that changed files, briefly state what changed and where.`;

export function buildSystemPrompt(opts: { cwd: string; permissionMode: PermissionMode; modelName: string; subagent?: boolean; mcpServers: string[] }): string {
  const settings = store.getSettings();
  const now = new Date();
  const date = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" });
  const parts: string[] = [BASE];

  parts.push(
    `# Environment
- Working directory: ${opts.cwd}
- Home directory: ${HOME}
- Platform: ${os.platform()} ${os.release()} (${os.arch()})
- Shell: ${SHELL}
- Git repository: ${gitInfo(opts.cwd)}
- Today's date: ${date}
- Model: ${opts.modelName}`,
  );

  if (opts.permissionMode === "plan") {
    parts.push(
      `# Plan mode (read-only)
The user has enabled plan mode. Do NOT modify files or run commands with side effects. Investigate with read-only tools, then present a concrete step-by-step plan and wait for the user to approve and switch modes.`,
    );
  }

  if (opts.subagent) {
    parts.push(
      `# You are a subagent
You were launched by another agent to complete one self-contained task. You cannot talk to the user. Work autonomously, then finish with a concise, factual report of what you found or did (include file paths and key evidence). The report is your final message.`,
    );
  }

  const instructions = collectInstructions(opts.cwd);
  if (instructions.length || settings.systemPromptAppend.trim()) {
    const blocks = instructions.map(
      (f) => `<instructions source="${collapseHome(f.path)}" scope="${f.scope}">\n${f.content}\n</instructions>`,
    );
    if (settings.systemPromptAppend.trim()) blocks.push(`<instructions source="app settings">\n${settings.systemPromptAppend.trim()}\n</instructions>`);
    parts.push(
      `# User and project instructions
The following instructions were provided by the user. They take precedence over the default guidance above. Project-scoped instructions apply to work in that directory tree.

${blocks.join("\n\n")}`,
    );
  }

  const skills = discoverSkills(opts.cwd);
  if (skills.length) {
    const list = skills
      .map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").slice(0, 280)}`)
      .join("\n");
    parts.push(
      `# Available skills
Skills are packaged instructions for specific kinds of tasks. When a task matches a skill's description, call the skill tool with its name first.

${list}`,
    );
  }

  if (opts.mcpServers.length) {
    parts.push(`# MCP servers
Tools prefixed with mcp__<server>__ come from these connected MCP servers: ${opts.mcpServers.join(", ")}.`);
  }

  return parts.join("\n\n");
}
