// Memory files on disk: migration from the old layout, revisions and history, secrets, and what disclosure allows editing.
import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import * as store from "./db";
import { allMemories, getMemory, hashMemory, migrateMemories, writeMemory } from "./memory";
import { prepareMemory } from "./memory-retrieval";
import { memoryTools } from "./tools/memory";
import { useMemoryFixture, input } from "./testing/memory-fixture";

useMemoryFixture();

test("migration backs up exact bytes, preserves body/date and gives stable identity", () => {
  const dir = path.join(process.env.KESTREL_MEMORY_DIR!, "people"); fs.mkdirSync(dir, { recursive: true });
  const old = '---\ndescription: "A person"\ntype: "user"\nmodified: "2025-01-01T00:00:00.000Z"\n---\n\nA remembered fact.\n';
  fs.writeFileSync(path.join(dir, "someone.md"), old);
  expect(migrateMemories()).toBe(1);
  const m = getMemory("people/someone")!;
  expect(m.id.startsWith("mem_")).toBe(true);
  expect(m.content).toBe("A remembered fact.");
  expect(m.modifiedAt).toBe(Date.parse("2025-01-01"));
  expect(fs.readFileSync(path.join(process.env.KESTREL_MEMORY_DIR!, ".migration-v2/people/someone.md"), "utf8")).toBe(old);
  expect(migrateMemories()).toBe(0);
  const renamed = writeMemory({ ...m, topic: "contacts", name: "alias" }, { from: m.id, expectedRevision: m.revision }).entry;
  expect(renamed.id).toBe(m.id);
  expect(getMemory("people/someone")).toBeNull();
  expect(getMemory(m.id)?.locator).toBe("contacts/alias");
});

test("updates require a current read revision, history is recoverable and secrets are rejected", () => {
  const m = writeMemory(input()).entry;
  expect(() => writeMemory(input("tea", "Changed"))).toThrow("not read");
  const updated = writeMemory(input("tea", "Prefers green tea."), { from: m.id, expectedRevision: m.revision }).entry;
  expect(() => writeMemory(input(), { from: m.id, expectedRevision: m.revision })).toThrow("Memory changed");
  expect(fs.existsSync(path.join(process.env.KESTREL_MEMORY_DIR!, ".history", m.id, `${m.revision}.md`))).toBe(true);
  expect(updated.revision).not.toBe(m.revision);
  expect(() => writeMemory(input("secret", "password=verysecretpassword"))).toThrow("secret");
});

test("full disclosed notes permit updates while titles alone do not", async () => {
  const m = writeMemory(input()).entry; await prepareMemory(store.getSettings());
  const read = new Map<string, string>();
  const tools = memoryTools({ settings: store.getSettings, sessionId: "s", readMemories: read } as any, { readOnly: false });
  await expect(tools[2].execute("w", { ...input(), id: m.id })).rejects.toThrow("not read");
  await tools[1].execute("r", { ids: [m.id] });
  await tools[2].execute("w", { ...input("tea", "Prefers mint tea."), id: m.id });
  expect(getMemory(m.id)?.content).toBe("Prefers mint tea.");
  expect(hashMemory("x")).toHaveLength(64);
});

test("migration preserves missing timestamps and resolves copied identities without changing bodies", () => {
  const dir = path.join(process.env.KESTREL_MEMORY_DIR!, "people"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "original.md");
  fs.writeFileSync(file, '---\r\ndescription: "Original"\r\n---\r\nA fact.\r\n');
  fs.utimesSync(file, new Date("2024-01-01"), new Date("2024-01-01"));
  const before = getMemory("people/original")!;
  migrateMemories();
  const original = getMemory("people/original")!;
  expect(original.modifiedAt).toBe(before.modifiedAt);
  expect(original.content).toBe(before.content);
  fs.copyFileSync(file, path.join(dir, "copy.md"));
  migrateMemories();
  expect(new Set(allMemories().map((m) => m.id)).size).toBe(2);
  expect(migrateMemories()).toBe(0);
});

test("migration preserves file dates when legacy metadata is invalid, including an epoch timestamp", () => {
  const dir = path.join(process.env.KESTREL_MEMORY_DIR!, "people"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "invalid-date.md");
  fs.writeFileSync(file, '---\nschema: "1"\nmodified: "unknown"\n---\nA fact.\n');
  fs.utimesSync(file, new Date("2024-01-01"), new Date("2024-01-01"));
  fs.writeFileSync(path.join(dir, "epoch.md"), '---\nmodified: "1970-01-01T00:00:00.000Z"\n---\nAnother fact.\n');
  expect(migrateMemories()).toBe(2);
  expect(getMemory("people/invalid-date")?.modifiedAt).toBe(Date.parse("2024-01-01"));
  expect(getMemory("people/epoch")?.modifiedAt).toBe(0);
  expect(fs.readFileSync(file, "utf8")).not.toContain('schema: "1"');
  expect(getMemory("people/invalid-date")?.content).toBe("A fact.");
  expect(migrateMemories()).toBe(0);
});
