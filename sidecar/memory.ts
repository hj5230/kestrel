// Notes the agent keeps across sessions, stored as plain Markdown files the user can also read and edit:
//   ~/.kestrel/memory/<topic>/<name>.md   (frontmatter: name, description, type, source, modified)
// Files, not a database, so they survive reinstalls, diff cleanly and can be synced or edited by hand. Listing is
// a directory scan; semantic vectors live in a rebuildable SQLite index beside these files.
// Deleted notes move to .trash instead of vanishing, because the agent can delete on its own.
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { MemoryEntry, MemoryEvidence, MemorySummary, MemoryType } from "../shared/protocol";
import { HOME } from "./env";
import { parseFrontmatter } from "./skills";

export const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

export const LIMITS = { topic: 40, name: 60, description: 200, content: 8000, entries: 10000, trash: 100 };

// Content hashes detect both app updates and edits made in an external editor.
export const hashMemory = (value: string) => createHash("sha256").update(value).digest("hex");

function metadata<T>(value: string | undefined): T[] {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

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

/** A stored credential could be disclosed into future prompts, long after the original conversation. */
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
  const ids = new Set<string>();
  for (const { entry } of out) {
    // Files copied by hand receive their own identity during the next migration.
    if (ids.has(entry.id)) entry.id = `mem_${hashMemory(entry.locator).slice(0, 24)}`;
    ids.add(entry.id);
  }
  return out.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
}

const summary = ({ content: _c, evidence: _e, ...s }: MemoryEntry): MemorySummary => s;

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

export interface MemoryInput {
  aliases?: string[];
  evidence?: MemoryEvidence[];
  topic: string;
  name: string;
  type: MemoryType;
  description: string;
  content: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function validateMemoryInput(input: MemoryInput): { topic: string; name: string; description: string; content: string } {
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
  if (input.aliases && (!Array.isArray(input.aliases) || input.aliases.length > 30 || input.aliases.some((a) => typeof a !== "string" || a.length > 120))) throw new Error("Invalid memory aliases");
  if (input.evidence && (!Array.isArray(input.evidence) || input.evidence.some((e) => !e || typeof e.sessionId !== "string" || !Number.isInteger(e.seq) || typeof e.quote !== "string"))) throw new Error("Invalid memory evidence");
  const secret = findSecret(`${description}\n${content}\n${JSON.stringify({ aliases: input.aliases, evidence: input.evidence })}`);
  if (secret) throw new Error(`Refusing to save: this looks like it contains a secret (${secret}). Describe where it lives instead of storing its value.`);
  return { topic, name, description, content };
}

// Written as `key: "value"` on one line. parseFrontmatter strips one pair of outer quotes and nothing else,
// so always quoting round-trips any value, including ones containing quotes or colons.
const field = (k: string, v: string) => `${k}: "${oneLine(v)}"`;

function atomicWrite(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
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
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.renameSync(l.file, path.join(dir, `${Date.now()}-${l.entry.topic}-${l.entry.name}.md`));
  dropEmptyTopicDir(l.file);
  const old = fs.readdirSync(dir).sort();
  for (const f of old.slice(0, Math.max(0, old.length - LIMITS.trash))) fs.rmSync(path.join(dir, f), { force: true });
}

/**
 * Full replacements require the revision that was read. `from` pins the identity across renames and moves;
 * moving a note cannot overwrite a different identity at the destination.
 */
export function writeMemory(input: MemoryInput, opts: { source?: string; from?: string; expectedRevision?: string } = {}): { entry: MemoryEntry; created: boolean } {
  const v = validateMemoryInput(input);
  const all = scan();
  const locator = `${v.topic}/${v.name}`;
  const existing = all.find((l) => l.entry.locator === locator);
  const prev = opts.from ? all.find((l) => l.entry.id === opts.from || l.entry.locator === opts.from) : undefined;
  if (opts.from && !prev) throw new Error(`Memory ${opts.from} no longer exists`);
  if (prev && existing && prev.entry.id !== existing.entry.id) throw new Error(`A memory named ${locator} already exists`);
  if (!existing && !prev && all.length >= LIMITS.entries) {
    throw new Error(`Memory is full (${LIMITS.entries} notes). Delete or merge obsolete notes first.`);
  }
  const target = existing ?? prev;
  if (target && opts.expectedRevision !== target.entry.revision) throw new Error("Memory changed or was not read. Read the current note and retry with its revision.");
  const id = target?.entry.id ?? `mem_${randomUUID()}`;
  const aliases = [...new Set(input.aliases ?? target?.entry.aliases ?? [])].slice(0, 30);
  if (aliases.some((a) => typeof a !== "string" || a.length > 120)) throw new Error("Invalid memory aliases");
  const evidence = [...(target?.entry.evidence ?? []), ...(input.evidence ?? [])]
    .filter((e, i, a) => a.findIndex((x) => x.sessionId === e.sessionId && x.seq === e.seq && x.quote === e.quote) === i).slice(-40);
  if (findSecret(JSON.stringify({ aliases, evidence }))) throw new Error("Refusing to save credentials in memory metadata");
  if (target) {
    const history = path.join(memoryDir(), ".history", id, `${target.entry.revision}.md`);
    fs.mkdirSync(path.dirname(history), { recursive: true, mode: 0o700 });
    fs.copyFileSync(target.file, history);
    fs.chmodSync(history, 0o600);
  }
  const file = existing?.file ?? path.join(memoryDir(), v.topic, `${v.name}.md`);
  const modifiedAt = Date.now();
  const source = opts.source ?? target?.entry.source ?? "";
  const text = [
    "---",
    field("memory_id", id),
    field("schema", "2"),
    field("aliases", JSON.stringify(aliases)),
    field("evidence", JSON.stringify(evidence)),
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
    entry: { id, locator, revision: hashMemory(text), aliases, evidence, topic: v.topic, name: v.name, type: input.type, description: v.description, source, modifiedAt, content: v.content },
  };
}

export function deleteMemory(id: string): MemorySummary {
  const l = scan().find((x) => x.entry.id === id || x.entry.locator === id);
  if (!l) throw new Error(`No memory ${id}`);
  atomicWrite(path.join(memoryDir(), ".deletion-epoch"), randomUUID());
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
