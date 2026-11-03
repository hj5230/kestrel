// A ready merge must wait for an active target, survive restart and apply once with atomic archival.
import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./db";
import { createSession } from "./sessions";
import { assertNotMerging, drainMergeJobs, listMergeJobs, queueMerge } from "./merge-jobs";

const settle = () => new Promise((r) => setTimeout(r, 30));

test("merge acceptance is immediate and duplicate requests share the job", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-merge-job-"));
  store.openDb(dir, true);
  const source = createSession({ cwd: dir });
  const target = createSession({ cwd: dir });
  store.updateSession(source.id, { status: "running" });
  const job = queueMerge(source.id, target.id, "Keep decisions");
  expect(queueMerge(source.id, target.id).id).toBe(job.id);
  expect(job.state).toBe("queued");
  expect(() => assertNotMerging(source.id)).toThrow();
  expect(() => queueMerge(target.id, source.id)).toThrow();
  await settle();
  store.db.close();
});

test("ready merge survives reopen, waits for target and commits only once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-merge-ready-"));
  store.openDb(dir, true);
  const source = createSession({ cwd: dir });
  const target = createSession({ cwd: dir });
  store.appendMessage(source.id, { role: "user", content: "Source work", timestamp: 1 });
  const snapshot = JSON.stringify({ messages: store.loadMessages(source.id), compactions: [] });
  const note = { role: "user", content: "Merged work", timestamp: 2 };
  store.db.run("INSERT INTO merge_jobs (id, source_id, target_id, state, snapshot, summary, created_at, updated_at) VALUES ('job', ?, ?, 'ready', ?, ?, 1, 1)", [source.id, target.id, snapshot, JSON.stringify(note)]);
  store.db.close();
  store.openDb(dir, true);
  store.updateSession(target.id, { status: "running" });
  await drainMergeJobs();
  await settle();
  expect(store.loadMessages(target.id)).toHaveLength(0);
  expect(store.getSession(source.id)?.archived).toBe(false);
  store.updateSession(target.id, { status: "idle" });
  await drainMergeJobs();
  await settle();
  await drainMergeJobs();
  expect(store.loadMessages(target.id)).toHaveLength(1);
  expect(store.getSession(source.id)?.archived).toBe(true);
  expect(listMergeJobs()[0].state).toBe("succeeded");
  store.db.close();
});

test("a failed atomic commit rolls back the note and leaves the source unarchived", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-merge-rollback-"));
  store.openDb(dir, true);
  const source = createSession({ cwd: dir });
  const target = createSession({ cwd: dir });
  store.db.run("INSERT INTO merge_jobs (id, source_id, target_id, state, snapshot, summary, created_at, updated_at) VALUES ('job', ?, ?, 'ready', ?, ?, 1, 1)", [source.id, target.id, JSON.stringify({ messages: [], compactions: [] }), JSON.stringify({ role: "user", content: "note", timestamp: 2 })]);
  store.db.run("CREATE TRIGGER fail_archive BEFORE UPDATE OF archived ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await drainMergeJobs();
  await settle();
  expect(store.loadMessages(target.id)).toHaveLength(0);
  expect(store.getSession(source.id)?.archived).toBe(false);
  expect(listMergeJobs()[0].state).toBe("failed");
  store.db.close();
});
