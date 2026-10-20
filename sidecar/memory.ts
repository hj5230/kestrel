// Notes the agent keeps across sessions, stored as plain Markdown files the user can also read and edit:
//   ~/.kestrel/memory/<topic>/<name>.md   (frontmatter: name, description, type, source, modified)
// Files, not a database, so they survive reinstalls, diff cleanly and can be synced or edited by hand. Listing is
// a directory scan: the store is capped at MAX_ENTRIES, so there is nothing to index or keep in sync.
// Deleted notes move to .trash instead of vanishing, because the agent can delete on its own.
import fs from "node:fs";
import path from "node:path";
import type { MemoryEntry, MemorySummary, MemoryType } from "../shared/protocol";
import { HOME } from "./env";
import { parseFrontmatter } from "./skills";

export const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

export const LIMITS = { topic: 40, name: 60, description: 200, content: 8000, entries: 500, trash: 100 };

// What the agent sees at the start of a session. Same ceiling as Claude Code's MEMORY.md, so the index stays cheap.
export const INDEX_MAX_LINES = 200;
export const INDEX_MAX_BYTES = 25_000;

const TRASH = ".trash";

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
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}/, "API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{8,}/i, "credential"],
];

/** A memory is read back into every future prompt, so a pasted credential would leak into all of them. */
export function findSecret(text: string): string | null {
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

interface Located {
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
  const type = MEMORY_TYPES.includes(attrs.type as MemoryType) ? (attrs.type as MemoryType) : "reference";
  return {
    file,
    entry: {
      id: `${topic}/${name}`,
      topic,
      name,
      type,
      description: attrs.description || content.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, LIMITS.description) || "",
      source: attrs.source ?? "",
      modifiedAt: Date.parse(attrs.modified ?? "") || mtime,
      content,
    },
  };
}

// The topic is the folder and the name is the file name, so an id always maps to exactly one path even for
// files the user dropped in by hand with names that aren't slugs.
function scan(): Located[] {
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
  return out.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
}

const summary = ({ content: _c, ...s }: MemoryEntry): MemorySummary => s;

export function listMemories(): MemorySummary[] {
  return scan().map((l) => summary(l.entry));
}

export function getMemory(id: string): MemoryEntry | null {
  return scan().find((l) => l.entry.id === id)?.entry ?? null;
}

export function searchMemories(query: string, opts: { topic?: string; limit?: number } = {}): MemorySummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const topic = opts.topic ? slug(opts.topic, LIMITS.topic) : "";
  const limit = opts.limit ?? 20;
  const pool = scan().filter((l) => !topic || l.entry.topic === topic);
  if (!terms.length) {
    return pool
      .map((l) => l.entry)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, limit)
      .map(summary);
  }
  return pool
    .map(({ entry: e }) => {
      const id = e.id.toLowerCase();
      const desc = e.description.toLowerCase();
      const body = e.content.toLowerCase();
      let score = 0;
      for (const term of terms) score += (id.includes(term) ? 3 : 0) + (desc.includes(term) ? 2 : 0) + (body.includes(term) ? 1 : 0);
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.modifiedAt - a.e.modifiedAt)
    .slice(0, limit)
    .map((x) => summary(x.e));
}

export interface MemoryInput {
  topic: string;
  name: string;
  type: MemoryType;
  description: string;
  content: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function validate(input: MemoryInput): { topic: string; name: string; description: string; content: string } {
  const topic = slug(input.topic, LIMITS.topic);
  const name = slug(input.name, LIMITS.name);
  if (!topic) throw new Error("topic must contain letters or digits");
  if (!name) throw new Error("name must contain letters or digits");
  if (!MEMORY_TYPES.includes(input.type)) throw new Error(`type must be one of: ${MEMORY_TYPES.join(", ")}`);
  const description = oneLine(input.description);
  const content = input.content.trim();
  if (!description) throw new Error("description is required: one line saying what the note is about");
  if (description.length > LIMITS.description) throw new Error(`description is ${description.length} characters; keep it under ${LIMITS.description}`);
  if (!content) throw new Error("content is required");
  if (content.length > LIMITS.content) throw new Error(`content is ${content.length} characters; keep a note under ${LIMITS.content}, or split it into several notes`);
  const secret = findSecret(`${description}\n${content}`);
  if (secret) throw new Error(`Refusing to save: this looks like it contains a secret (${secret}). Describe where it lives instead of storing its value.`);
  return { topic, name, description, content };
}

// Written as `key: "value"` on one line. parseFrontmatter strips one pair of outer quotes and nothing else,
// so always quoting round-trips any value, including ones containing quotes or colons.
const field = (k: string, v: string) => `${k}: "${oneLine(v)}"`;

function atomicWrite(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function dropEmptyTopicDir(file: string) {
  try {
    fs.rmdirSync(path.dirname(file));
  } catch {
    // topic folder still has notes
  }
}

function trash(l: Located) {
  const dir = path.join(memoryDir(), TRASH);
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(l.file, path.join(dir, `${Date.now()}-${l.entry.topic}-${l.entry.name}.md`));
  dropEmptyTopicDir(l.file);
  const old = fs.readdirSync(dir).sort();
  for (const f of old.slice(0, Math.max(0, old.length - LIMITS.trash))) fs.rmSync(path.join(dir, f), { force: true });
}

/**
 * Creates or replaces the note at topic/name. `from` is the previous id when the settings page renames or moves a
 * note; it refuses to overwrite a different note, while the agent (no `from`) replaces by design.
 */
export function writeMemory(input: MemoryInput, opts: { source?: string; from?: string } = {}): { entry: MemoryEntry; created: boolean } {
  const v = validate(input);
  const all = scan();
  const id = `${v.topic}/${v.name}`;
  const existing = all.find((l) => l.entry.id === id);
  const prev = opts.from ? all.find((l) => l.entry.id === opts.from) : undefined;
  if (opts.from && !prev) throw new Error(`Memory ${opts.from} no longer exists`);
  if (prev && existing && prev.entry.id !== existing.entry.id) throw new Error(`A memory named ${id} already exists`);
  if (!existing && !prev && all.length >= LIMITS.entries) {
    throw new Error(`Memory is full (${LIMITS.entries} notes). Delete or merge obsolete notes first.`);
  }
  const target = existing ?? prev;
  const file = existing?.file ?? path.join(memoryDir(), v.topic, `${v.name}.md`);
  const modifiedAt = Date.now();
  const source = opts.source ?? target?.entry.source ?? "";
  const text = [
    "---",
    field("name", v.name),
    field("description", v.description),
    field("type", input.type),
    ...(source ? [field("source", source)] : []),
    field("modified", new Date(modifiedAt).toISOString()),
    "---",
    "",
    v.content,
    "",
  ].join("\n");
  atomicWrite(file, text);
  // Moved or renamed: the content now lives at the new path, so the old file just goes (nothing to recover).
  if (prev && prev.file !== file) {
    fs.rmSync(prev.file, { force: true });
    dropEmptyTopicDir(prev.file);
  }
  return {
    created: !existing && !prev,
    entry: { id, topic: v.topic, name: v.name, type: input.type, description: v.description, source, modifiedAt, content: v.content },
  };
}

export function deleteMemory(id: string): MemorySummary {
  const l = scan().find((x) => x.entry.id === id);
  if (!l) throw new Error(`No memory ${id}`);
  trash(l);
  return summary(l.entry);
}

export function ageLabel(modifiedAt: number, now = Date.now()): string {
  const days = Math.floor((now - modifiedAt) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** The lines of the system-prompt index, newest notes first when the caps force a cut. */
export function memoryIndex(now = Date.now()): { lines: string[]; total: number } {
  const all = listMemories();
  const byRecency = [...all].sort((a, b) => b.modifiedAt - a.modifiedAt);
  const kept: MemorySummary[] = [];
  let bytes = 0;
  const line = (m: MemorySummary) => `- ${m.id} [${m.type}] ${m.description} (${ageLabel(m.modifiedAt, now)})`;
  for (const m of byRecency) {
    const size = Buffer.byteLength(line(m)) + 1;
    if (kept.length >= INDEX_MAX_LINES || bytes + size > INDEX_MAX_BYTES) break;
    kept.push(m);
    bytes += size;
  }
  kept.sort((a, b) => a.id.localeCompare(b.id));
  return { lines: kept.map(line), total: all.length };
}
