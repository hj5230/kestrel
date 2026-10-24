import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FILE_ATTACHMENT_MAX_BYTES } from "../shared/protocol";
import * as store from "./db";
import { createSession } from "./sessions";
import { startServer } from "./server";
import { sanitizeUploadName, sessionUploadDir, storeUpload } from "./uploads";

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
