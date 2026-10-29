// Pictures the webview can't decode go through ffmpeg and come back as a JPEG every vision API accepts.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "./db";
import { convertImage, ffmpegPath } from "./media";

store.openDb(fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-media-db-")), true);
const ffmpeg = ffmpegPath();

test.skipIf(!ffmpeg)("a large image is scaled to 2048px and stays under the per-image limit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-media-"));
  const src = path.join(dir, "big.png");
  spawnSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=4032x3024", "-frames:v", "1", "-y", src]);
  const out = await convertImage(fs.readFileSync(src).toString("base64"), "photo.png");
  expect(out.mimeType).toBe("image/jpeg");
  const bytes = Buffer.from(out.data, "base64");
  expect(bytes.length).toBeLessThan(3.75 * 1024 * 1024);
  // JPEG SOF0 marker: height then width, two bytes each.
  const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  expect([bytes.readUInt16BE(sof + 5), bytes.readUInt16BE(sof + 7)]).toEqual([1536, 2048]);
});

test.skipIf(!ffmpeg)("unreadable data and a missing ffmpeg are reported, not passed on", async () => {
  await expect(convertImage(Buffer.from("not an image").toString("base64"), "x.heic")).rejects.toThrow();
  store.saveSettings({ ffmpegPath: "/nonexistent/ffmpeg" });
  await expect(convertImage("AAAA", "x.png")).rejects.toThrow(/ffmpeg/);
  store.saveSettings({ ffmpegPath: "" });
});
