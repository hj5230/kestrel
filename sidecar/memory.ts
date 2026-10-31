// Notes the agent keeps across sessions, stored as plain Markdown files the user can also read and edit:
//   ~/.kestrel/memory/<topic>/<name>.md   (frontmatter: name, description, type, source, modified)
// Files, not a database, so they survive reinstalls, diff cleanly and can be synced or edited by hand. Listing is
// a directory scan; semantic vectors live in a rebuildable SQLite index beside these files.
// Deleted notes move to .trash instead of vanishing, because the agent can delete on its own.
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { MemoryEntry, MemoryEvidence, MemorySummary, MemoryType } from "../shared/protocol";
import { HOME } from "./env";
import { parseFrontmatter } from "./skills";
import { atomicWrite } from "./memory/write";
export { validateMemoryInput, writeMemory, deleteMemory, type MemoryInput } from "./memory/write";

export const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

export const LIMITS = { topic: 40, name: 60, description: 200, content: 8000, entries: 10000, trash: 100 };

// Content hashes detect both app updates and edits made in an external editor.
export const hashMemory = (value: string) => createHash("sha256").update(value).digest("hex");

export function metadata<T>(value: string | undefined): T[] {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export const TRASH = ".trash";

export function memoryDir(): string {
  return process.env.KESTREL_MEMORY_DIR || path.join(HOME, ".kestrel", "memory");
}

/** Lowercase, unicode-aware, dash-separated. Doubles as the path-traversal guard: the result never contains "/" or ".". */
export function slug(s: string, max: number): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bksk_[A-Za-z0-9_-]{20,}\b/, "Kiro API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}/, "API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{8,}/i, "credential"],
];

/** A stored credential could be disclosed into future prompts, long after the original conversation. */
export function findSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

export interface Located {
  entry: MemoryEntry;
  file: string;
}

function load(file: string, topic: string, name: string): Located | null {
  let src: string;
  let mtime: number;
  try {
    src = fs.readFileSync(file, "utf8");
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const { attrs, body } = parseFrontmatter(src);
  const content = body.trim();
  const modified = Date.parse(attrs.modified ?? "");
  const type = MEMORY_TYPES.includes(attrs.type as MemoryType) ? (attrs.type as MemoryType) : "reference";
  return {
    file,
    entry: {
      id: /^mem_[a-zA-Z0-9-]+$/.test(attrs.memory_id ?? "") ? attrs.memory_id : `mem_${hashMemory(`${topic}/${name}`).slice(0, 24)}`,
      locator: `${topic}/${name}`,
      revision: hashMemory(src),
      aliases: metadata<string>(attrs.aliases).filter((v) => typeof v === "string"),
      evidence: metadata<MemoryEvidence>(attrs.evidence).filter((e) => e && typeof e.sessionId === "string" && Number.isInteger(e.seq) && typeof e.quote === "string"),
      topic,
      name,
      type,
      description: attrs.description || content.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, LIMITS.description) || "",
      source: attrs.source ?? "",
      modifiedAt: Number.isFinite(modified) ? modified : mtime,
      content,
    },
  };
}

// The locator follows the actual folder and file names, including manually added files that aren't slugs.
// Stable IDs survive moves; copied files are assigned independent identities below.
export function scan(): Located[] {
  const root = memoryDir();
  const out: Located[] = [];
  let topics: fs.Dirent[];
  try {
    topics = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const t of topics) {
    if (!t.isDirectory() || t.name.startsWith(".")) continue;
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(path.join(root, t.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".md") || f.name.startsWith(".")) continue;
      const loaded = load(path.join(root, t.name, f.name), t.name, f.name.slice(0, -3));
      if (loaded) out.push(loaded);
    }
  }
  const ids = new Set<string>();
  for (const { entry } of out) {
    // Files copied by hand receive their own identity during the next migration.
    if (ids.has(entry.id)) entry.id = `mem_${hashMemory(entry.locator).slice(0, 24)}`;
    ids.add(entry.id);
  }
  return out.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
}

export const summary = ({ content: _c, evidence: _e, ...s }: MemoryEntry): MemorySummary => s;

export function listMemories(): MemorySummary[] {
  return scan().map((l) => summary(l.entry));
}

export function getMemory(id: string): MemoryEntry | null {
  return scan().find((l) => l.entry.id === id || l.entry.locator === id)?.entry ?? null;
}

export function allMemories(): MemoryEntry[] {
  return scan().map((l) => l.entry);
}

/** Migration never rewrites the body or dates. A byte-for-byte backup is kept before adding identity. */
export function migrateMemories(): number {
  let count = 0;
  for (const l of scan()) {
    const original = fs.readFileSync(l.file, "utf8");
    const { attrs } = parseFrontmatter(original);
    if (attrs.memory_id === l.entry.id) continue;
    const backup = path.join(memoryDir(), ".migration-v2", l.entry.topic, `${l.entry.name}.md`);
    fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });
    const hasDate = Number.isFinite(Date.parse(attrs.modified ?? ""));
    const fields = `memory_id: "${l.entry.id}"\nschema: "2"\n` + (hasDate ? "" : `modified: "${new Date(l.entry.modifiedAt).toISOString()}"\n`);
    const header = original.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    // Remove superseded keys so a legacy schema or invalid date cannot override the new metadata.
    const preserved = (header?.[1] ?? "").replace(/^(?:memory_id|schema):.*(?:\r?\n|$)/gm, "");
    const next = header
      ? `---\n${fields}${hasDate ? preserved : preserved.replace(/^modified:.*(?:\r?\n|$)/gm, "")}\n---\n${original.slice(header[0].length)}`
      : `---\n${fields}---\n${original}`;
    atomicWrite(l.file, next);
    count++;
  }
  return count;
}

/** Includes a deletion epoch so an in-flight background job cannot recreate a forgotten note. */
export function memoryEpoch(): string {
  try { return fs.readFileSync(path.join(memoryDir(), ".deletion-epoch"), "utf8"); } catch { return ""; }
}

export function memorySnapshot(): string {
  return hashMemory(memoryEpoch() + allMemories().map((m) => `${m.id}:${m.revision}`).join("|"));
}

export function ageLabel(modifiedAt: number, now = Date.now()): string {
  const days = Math.floor((now - modifiedAt) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
