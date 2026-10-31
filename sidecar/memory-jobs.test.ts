// Saving memories from conversations in the background: evidence, retries, crash recovery and pausing.
import { expect, test } from "bun:test";
import * as store from "./db";
import { allMemories, deleteMemory, memoryEpoch, writeMemory } from "./memory";
import { drainMemoryJobs, memoryJobCounts } from "./memory-jobs";
import { useMemoryFixture, mock, input, session } from "./testing/memory-fixture";

useMemoryFixture();

test("durable extraction saves source evidence and usage; truncation and forgetting revoke pending jobs", async () => {
  const info = session();
  mock.notes = [{ ...input(), id: null, aliases: ["jasmine"], quote: "I like jasmine tea" }];
  store.appendMessage(info.id, { role: "user", content: "I like jasmine tea", timestamp: Date.now() }, memoryEpoch());
  expect(memoryJobCounts().pending).toBe(1);
  await drainMemoryJobs();
  expect(memoryJobCounts()).toMatchObject({ pending: 0, failed: 0 });
  expect(allMemories()[0].evidence[0]).toMatchObject({ sessionId: info.id, quote: "I like jasmine tea" });
  expect((store.db.query("SELECT count(*) AS n FROM usage_events WHERE purpose = 'memory'").get() as any).n).toBe(1);
  const second = store.appendMessage(info.id, { role: "user", content: "I like jasmine tea", timestamp: Date.now() }, memoryEpoch());
  deleteMemory(allMemories()[0].id);
  await drainMemoryJobs(); expect(allMemories()).toHaveLength(0);
  store.appendMessage(info.id, { role: "user", content: "A revoked message", timestamp: Date.now() }, memoryEpoch());
  store.truncateMessages(info.id, second.seq);
  expect(memoryJobCounts().pending).toBe(0);
});

test("unsupported evidence and unavailable models keep an explicit retryable job without saving", async () => {
  const info = session(); mock.notes = [{ ...input(), id: null, quote: "not in the message" }];
  store.appendMessage(info.id, { role: "user", content: "I like tea", timestamp: Date.now() }, memoryEpoch());
  await drainMemoryJobs();
  expect(allMemories()).toHaveLength(0);
  expect(memoryJobCounts().pending).toBe(1);
  store.db.run("UPDATE memory_jobs SET next_at = 0"); mock.mode = "/embed"; mock.calls = [];
  await drainMemoryJobs();
  expect(mock.calls.some((c) => c.path.includes("chat"))).toBe(false);
  expect(allMemories()).toHaveLength(0);
});

test("saved plans resume idempotently after a crash between note write and acknowledgement", async () => {
  const info = session(); const msg = { role: "user" as const, content: "I like tea", timestamp: Date.now() };
  const stored = store.appendMessage(info.id, msg, memoryEpoch());
  const planned = { input: { ...input(), evidence: [{ sessionId: info.id, seq: stored.seq, quote: msg.content }] } };
  writeMemory(planned.input);
  store.db.run("UPDATE memory_jobs SET plan = ?", [JSON.stringify([planned])]);
  await drainMemoryJobs();
  expect(allMemories()).toHaveLength(1);
  expect(memoryJobCounts().pending).toBe(0);
  expect(mock.calls.some((c) => c.path.includes("chat"))).toBe(false);
});

test("turning off automatic saving pauses a durable job without dropping it", async () => {
  const info = session();
  store.appendMessage(info.id, { role: "user", content: "I like tea", timestamp: Date.now() }, memoryEpoch());
  store.saveSettings({ memoryAutoSave: false });
  await drainMemoryJobs();
  expect(memoryJobCounts().pending).toBe(1);
  expect(mock.calls).toHaveLength(0);
});
