import { createTwoFilesPatch } from "diff";
import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { EditDetails } from "../../shared/protocol";
import { expandHome } from "../env";
import { text, defineTool, type KestrelTool, type ToolContext } from "./types";
export { createLsTool, createGlobTool, createGrepTool } from "./search-tools";

export const IGNORED_DIRS = new Set([".git", "node_modules", ".DS_Store", "dist", "target", ".next", ".turbo", ".cache", "__pycache__", ".venv"]);
const IMAGE_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MAX_LINES = 2000;
const MAX_LINE_CHARS = 2000;

export function resolvePath(ctx: ToolContext, p: string): string {
  const expanded = expandHome(String(p ?? "").trim());
  return path.resolve(ctx.cwd(), expanded || ".");
}

function makeDiff(file: string, before: string, after: string): EditDetails {
  const patch = createTwoFilesPatch(file, file, before, after, "", "", { context: 3 });
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) added++;
    else if (inHunk && line.startsWith("-")) removed++;
  }
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  return { path: file, diff: start < 0 ? "" : lines.slice(start).join("\n"), added, removed };
}

function isBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function createReadTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "read",
    label: "Read file",
    category: "read",
    description:
      "Read a file from the local filesystem. Returns content with line numbers (cat -n format). " +
      `By default reads up to ${MAX_LINES} lines from the start; use offset (1-based line) and limit for large files. ` +
      "Supports images (png/jpg/gif/webp), which are returned as images. Paths may be absolute, ~-prefixed, or relative to the working directory. " +
      "Prefer reading several potentially relevant files in parallel.",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
      offset: Type.Optional(Type.Integer({ description: "1-based line number to start from", minimum: 1 })),
      limit: Type.Optional(Type.Integer({ description: "Maximum number of lines to read", minimum: 1 })),
    }),
    async execute(_id, params) {
      const file = resolvePath(ctx, params.path);
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat) throw new Error(`File does not exist: ${file}`);
      if (stat.isDirectory()) throw new Error(`${file} is a directory. Use the ls tool to list it.`);
      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXT[ext]) {
        if (stat.size > 8 * 1024 * 1024) throw new Error("Image is larger than 8MB");
        const data = fs.readFileSync(file).toString("base64");
        ctx.readFiles.set(file, stat.mtimeMs);
        return {
          content: [{ type: "text", text: `Image ${file} (${stat.size} bytes)` }, { type: "image", data, mimeType: IMAGE_EXT[ext] }],
          details: { path: file, image: true },
        };
      }
      if (stat.size > 20 * 1024 * 1024) throw new Error("File is larger than 20MB; use grep or bash (head/tail) instead.");
      const buf = fs.readFileSync(file);
      if (isBinary(buf)) throw new Error(`${file} appears to be a binary file.`);
      const lines = buf.toString("utf8").split("\n");
      const start = Math.max(0, (params.offset ?? 1) - 1);
      const limit = params.limit ?? MAX_LINES;
      const slice = lines.slice(start, start + limit);
      const width = String(start + slice.length).length;
      const body = slice
        .map((l, i) => {
          const line = l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) + " …[line truncated]" : l;
          return `${String(start + i + 1).padStart(width, " ")}\t${line}`;
        })
        .join("\n");
      ctx.readFiles.set(file, stat.mtimeMs);
      let note = "";
      if (start + slice.length < lines.length) {
        note = `\n\n[Showing lines ${start + 1}-${start + slice.length} of ${lines.length}. Use offset/limit to read more.]`;
      }
      if (!slice.length || (lines.length === 1 && lines[0] === "")) {
        return { content: text(`(file is empty: ${file})`), details: { path: file, lines: 0 } };
      }
      return { content: text(body + note), details: { path: file, lines: slice.length, total: lines.length } };
    },
  });
}

function checkFresh(ctx: ToolContext, file: string) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) return;
  const seen = ctx.readFiles.get(file);
  if (seen === undefined) throw new Error(`You must read ${file} with the read tool before modifying it.`);
  if (Math.abs(stat.mtimeMs - seen) > 1) throw new Error(`${file} was modified since you last read it. Read it again before editing.`);
}

export function createWriteTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "write",
    label: "Write file",
    category: "edit",
    description:
      "Write a file to the local filesystem, creating parent directories as needed. Overwrites existing files. " +
      "If the file already exists you must read it first. Prefer the edit tool for modifying existing files.",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
      content: Type.String({ description: "Full file content" }),
    }),
    async execute(_id, params) {
      const file = resolvePath(ctx, params.path);
      const exists = fs.existsSync(file);
      if (exists) checkFresh(ctx, file);
      const before = exists ? fs.readFileSync(file, "utf8") : "";
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, params.content);
      ctx.readFiles.set(file, fs.statSync(file).mtimeMs);
      const details = { ...makeDiff(file, before, params.content), created: !exists };
      return {
        content: text(`${exists ? "Updated" : "Created"} ${file} (${params.content.split("\n").length} lines)`),
        details,
      };
    },
  });
}

export function createEditTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "edit",
    label: "Edit file",
    category: "edit",
    description:
      "Perform an exact string replacement in a file. old_string must match the file content exactly (including whitespace and indentation) " +
      "and be unique unless replace_all is true. You must read the file before editing. To create a new file, use the write tool.",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
      old_string: Type.String({ description: "Exact text to replace" }),
      new_string: Type.String({ description: "Replacement text (must differ from old_string)" }),
      replace_all: Type.Optional(Type.Boolean({ description: "Replace every occurrence (default false)" })),
    }),
    async execute(_id, params) {
      const file = resolvePath(ctx, params.path);
      if (!fs.existsSync(file)) throw new Error(`File does not exist: ${file}. Use the write tool to create it.`);
      checkFresh(ctx, file);
      if (params.old_string === params.new_string) throw new Error("old_string and new_string are identical.");
      const before = fs.readFileSync(file, "utf8");
      if (!params.old_string) throw new Error("old_string must not be empty.");
      const count = before.split(params.old_string).length - 1;
      if (count === 0) {
        const trimmed = params.old_string.trim();
        const hint = trimmed && before.includes(trimmed) ? " A whitespace-trimmed version exists; check indentation and line endings." : "";
        throw new Error(`old_string not found in ${file}.${hint}`);
      }
      if (count > 1 && !params.replace_all) {
        throw new Error(`old_string occurs ${count} times in ${file}. Provide more surrounding context to make it unique, or set replace_all.`);
      }
      const after = params.replace_all
        ? before.split(params.old_string).join(params.new_string)
        : before.replace(params.old_string, () => params.new_string);
      fs.writeFileSync(file, after);
      ctx.readFiles.set(file, fs.statSync(file).mtimeMs);
      const details = makeDiff(file, before, after);
      return {
        content: text(`Edited ${file}: ${params.replace_all ? `${count} replacements` : "1 replacement"} (+${details.added} -${details.removed})`),
        details,
      };
    },
  });
}
