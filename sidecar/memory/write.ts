// Saving and deleting memory files: validation, secret checks, atomic writes, and a trash for deleted ones.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { MemoryEntry, MemoryEvidence, MemorySummary, MemoryType } from "../../shared/protocol";
import { MEMORY_TYPES, LIMITS, hashMemory, TRASH, memoryDir, slug, findSecret, scan, summary, type Located } from "../memory";

export interface MemoryInput {
  aliases?: string[];
  evidence?: MemoryEvidence[];
  topic: string;
  name: string;
  type: MemoryType;
  description: string;
  content: string;
}

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

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
export const field = (k: string, v: string) => `${k}: "${oneLine(v)}"`;

export function atomicWrite(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function dropEmptyTopicDir(file: string) {
  try {
    fs.rmdirSync(path.dirname(file));
  } catch {
    // topic folder still has notes
  }
}

export function trash(l: Located) {
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
