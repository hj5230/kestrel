import fs from "node:fs";
import path from "node:path";
import type { SkillInfo, SlashCommandInfo } from "../shared/protocol";
import * as store from "./db";
import { collapseHome, expandHome } from "./env";
import { st } from "./i18n";

export function parseFrontmatter(src: string): { attrs: Record<string, string>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { attrs: {}, body: src };
  const attrs: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const buf: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
      value = buf.join(value.startsWith(">") ? " " : "\n");
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attrs[kv[1]] = value;
  }
  return { attrs, body: src.slice(m[0].length) };
}

function projectDirs(cwd: string, kind: "skills" | "commands") {
  return [path.join(cwd, ".helm", kind), path.join(cwd, ".claude", kind), path.join(cwd, ".agents", kind)];
}

let skillCache: { key: string; at: number; skills: SkillInfo[] } | null = null;

export function discoverSkills(cwd: string, includeDisabled = false): SkillInfo[] {
  const settings = store.getSettings();
  const key = JSON.stringify([cwd, settings.skillDirs]);
  let skills: SkillInfo[];
  if (skillCache && skillCache.key === key && Date.now() - skillCache.at < 5000) {
    skills = skillCache.skills;
  } else {
    const seen = new Map<string, SkillInfo>();
    const dirs = [
      ...projectDirs(cwd, "skills").map((d) => ({ d, source: "project" })),
      ...settings.skillDirs.map((d) => ({ d: expandHome(d), source: collapseHome(expandHome(d)) })),
    ];
    for (const { d, source } of dirs) {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        const file = path.join(d, e.name, "SKILL.md");
        let src: string;
        try {
          src = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const { attrs } = parseFrontmatter(src);
        const name = attrs.name || e.name;
        if (seen.has(name)) continue;
        seen.set(name, { name, description: attrs.description || "", path: file, source });
      }
    }
    skills = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    skillCache = { key, at: Date.now(), skills };
  }
  if (includeDisabled) return skills;
  const disabled = new Set(settings.disabledSkills);
  return skills.filter((s) => !disabled.has(s.name));
}

export function findSkill(cwd: string, name: string): SkillInfo | null {
  return discoverSkills(cwd).find((s) => s.name === name) ?? null;
}

interface PromptCommand {
  name: string;
  description: string;
  body: string;
  source: string;
}

function scanCommands(dir: string, source: string, prefix = "", out: PromptCommand[] = []) {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanCommands(p, source, `${prefix}${e.name}:`, out);
    else if (e.name.endsWith(".md")) {
      try {
        const src = fs.readFileSync(p, "utf8");
        const { attrs, body } = parseFrontmatter(src);
        const firstLine = body.trim().split("\n")[0]?.replace(/^#+\s*/, "") ?? "";
        out.push({
          name: prefix + e.name.slice(0, -3),
          description: attrs.description || firstLine.slice(0, 120),
          body,
          source,
        });
      } catch {}
    }
  }
  return out;
}

export function discoverCommands(cwd: string): PromptCommand[] {
  const settings = store.getSettings();
  const all: PromptCommand[] = [];
  for (const d of projectDirs(cwd, "commands")) scanCommands(d, "project", "", all);
  for (const d of settings.commandDirs) scanCommands(expandHome(d), collapseHome(expandHome(d)), "", all);
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

function builtinCommands(): SlashCommandInfo[] {
  return [
    { name: "compact", description: st("cmdCompact"), kind: "builtin" },
    { name: "clear", description: st("cmdClear"), kind: "builtin" },
    { name: "model", description: st("cmdModel"), kind: "builtin" },
    { name: "export", description: st("cmdExport"), kind: "builtin" },
    { name: "fork", description: st("cmdFork"), kind: "builtin" },
  ];
}

export function listSlashCommands(cwd: string): SlashCommandInfo[] {
  const prompts = discoverCommands(cwd).map((c) => ({ name: c.name, description: c.description, kind: "prompt" as const, source: c.source }));
  const skills = discoverSkills(cwd).map((s) => ({ name: s.name, description: s.description, kind: "skill" as const, source: s.source }));
  return [...builtinCommands(), ...prompts, ...skills];
}

export function expandSlashCommand(cwd: string, input: string): string | null {
  const m = input.match(/^\/([^\s]+)\s*([\s\S]*)$/);
  if (!m) return null;
  const [, name, args] = m;
  const cmd = discoverCommands(cwd).find((c) => c.name === name);
  if (cmd) {
    const body = cmd.body.includes("$ARGUMENTS") ? cmd.body.replaceAll("$ARGUMENTS", args) : args ? `${cmd.body}\n\n${args}` : cmd.body;
    return body.trim();
  }
  const skill = findSkill(cwd, name);
  if (skill) {
    return `Use the "${skill.name}" skill for this request (call the skill tool with name "${skill.name}" first).${args ? `\n\n${args}` : ""}`;
  }
  return null;
}
