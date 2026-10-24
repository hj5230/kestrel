import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FILE_ATTACHMENT_MAX_BYTES } from "../shared/protocol";
import * as store from "./db";
import { createSession, forkSession } from "./sessions";
import { startServer } from "./server";
import { removeSessionUploads, sanitizeUploadName, sessionUploadDir, storeUpload, uploadRoot } from "./uploads";

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });

const rpc = (method: string, params: unknown) =>
  fetch(`http://127.0.0.1:${server.port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kestrel-token": "token" },
    body: JSON.stringify({ method, params }),
  }).then((r) => r.json());

let dataDir = "";
let project = "";
let server: ReturnType<typeof Bun.serve>;
let sessionId = "";

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-upload-data-"));
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-upload-project-")));
  store.openDb(dataDir, true);
  const session = createSession({ cwd: project, permissionMode: "auto" });
  sessionId = session.id;
  server = startServer({ port: 0, token: "token", dataDir, dev: true });
});

afterAll(() => server.stop(true));

describe("upload endpoint", () => {
  test("requires auth", async () => {
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    const res = await fetch(`http://127.0.0.1:${server.port}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(401);
  });

  test("stores uploads under a per-session directory with sanitized names", async () => {
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set("file", new File(["notes"], "../note.txt", { type: "text/plain" }));
    const res = await fetch(`http://127.0.0.1:${server.port}/upload`, {
      method: "POST",
      body: form,
      headers: { "x-kestrel-token": "token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("note.txt");
    expect(body.path.startsWith(sessionUploadDir(dataDir, sessionId) + path.sep)).toBe(true);
    expect(fs.existsSync(body.path)).toBe(true);
  });
});

describe("upload validation helpers", () => {
  test("sanitizes unsafe names", () => {
    expect(sanitizeUploadName("../a.txt")).toBe("a.txt");
    expect(sanitizeUploadName("..")).toBe("file");
    expect(sanitizeUploadName("")).toBe("file");
  });

  test("rejects traversal-style session ids", () => {
    expect(() => sessionUploadDir(dataDir, "../x")).toThrow();
    expect(() => sessionUploadDir(dataDir, "x/y")).toThrow();
  });

  test("rejects files above the configured size limit", async () => {
    await expect(
      storeUpload({
        dataDir,
        sessionId,
        fileName: "big.bin",
        mimeType: "application/octet-stream",
        sizeHint: FILE_ATTACHMENT_MAX_BYTES + 1,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
      }),
    ).rejects.toThrow();
  });
});

describe("upload safety", () => {
  test("a symlinked session folder is refused and nothing is written through it", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-upload-outside-"));
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
    const dir = sessionUploadDir(dataDir, sessionId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.symlinkSync(outside, dir);
    await expect(storeUpload({ dataDir, sessionId, fileName: "x.bin", stream: streamOf("hello") })).rejects.toThrow();
    expect(fs.readdirSync(outside)).toEqual(["keep.txt"]);
    fs.unlinkSync(dir);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test("cleanup ignores a non-id and never follows a symlink", () => {
    const victim = path.join(dataDir, "victim");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "keep.txt"), "keep");
    removeSessionUploads(dataDir, "../victim");
    expect(fs.existsSync(path.join(victim, "keep.txt"))).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-upload-link-"));
    fs.writeFileSync(path.join(outside, "keep.txt"), "keep");
    const link = path.join(uploadRoot(dataDir), "linkedsession");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    removeSessionUploads(dataDir, "linkedsession");
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);

    fs.rmSync(victim, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test("deleting a session removes its uploads, and a bad id removes nothing", async () => {
    const victim = path.join(dataDir, "victimdir");
    fs.mkdirSync(victim, { recursive: true });
    await rpc("sessions.delete", { id: "../victimdir" });
    expect(fs.existsSync(victim)).toBe(true);

    const s = createSession({ cwd: project, permissionMode: "auto" });
    const up = await storeUpload({ dataDir, sessionId: s.id, fileName: "a.txt", stream: streamOf("hi") });
    expect(fs.existsSync(up.path)).toBe(true);
    await rpc("sessions.delete", { id: s.id });
    expect(fs.existsSync(up.path)).toBe(false);
    fs.rmSync(victim, { recursive: true, force: true });
  });

  test("forking retargets attachment paths in the compaction summary", async () => {
    const s = createSession({ cwd: project, permissionMode: "auto" });
    const up = await storeUpload({ dataDir, sessionId: s.id, fileName: "note.txt", stream: streamOf("n") });
    store.addCompaction(s.id, 0, `the file is at ${up.path}`, 10, false);
    const forked = forkSession(s.id, 0, dataDir);
    const summary = store.listCompactions(forked.id)[0].summary;
    expect(summary).toContain(forked.id);
    expect(summary).not.toContain(s.id);
    expect(fs.existsSync(path.join(sessionUploadDir(dataDir, forked.id), "note.txt"))).toBe(true);
  });
});
