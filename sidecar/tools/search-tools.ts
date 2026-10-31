// Finding files and text: ls, glob and grep (ripgrep when installed).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Type } from "typebox";
import { getShellEnv, which } from "../env";
import { text, defineTool, type KestrelTool, type ToolContext } from "./types";
import { IGNORED_DIRS, resolvePath } from "./fs-tools";

export function createLsTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "ls",
    label: "List directory",
    category: "read",
    description: "List entries of a directory (non-recursive). Directories end with '/'. Common build/dependency folders are listed but not expanded.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Directory path (default: working directory)" })),
      all: Type.Optional(Type.Boolean({ description: "Include dotfiles" })),
    }),
    async execute(_id, params) {
      const dir = resolvePath(ctx, params.path ?? ".");
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const rows = entries
        .filter((e) => params.all || !e.name.startsWith("."))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 500)
        .map((e) => {
          if (e.isDirectory()) return `${e.name}/`;
          try {
            const s = fs.statSync(path.join(dir, e.name));
            return `${e.name}  (${s.size} B)`;
          } catch {
            return e.name;
          }
        });
      const more = entries.length > 500 ? `\n… ${entries.length - 500} more entries` : "";
      return { content: text(`${dir}\n${rows.join("\n")}${more}` || "(empty)"), details: { path: dir, count: entries.length } };
    },
  });
}

export function createGlobTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "glob",
    label: "Find files",
    category: "read",
    description:
      "Find files by glob pattern (e.g. '**/*.ts', 'src/**/index.{js,tsx}'). Returns paths sorted by modification time (newest first). " +
      "node_modules and .git are skipped unless the pattern names them.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern" }),
      path: Type.Optional(Type.String({ description: "Directory to search (default: working directory)" })),
    }),
    async execute(_id, params, signal) {
      const root = resolvePath(ctx, params.path ?? ".");
      const glob = new Bun.Glob(params.pattern);
      const skipIgnored = !/node_modules|\.git\b/.test(params.pattern);
      const hits: { p: string; m: number }[] = [];
      let scanned = 0;
      for await (const rel of glob.scan({ cwd: root, onlyFiles: true, dot: true, followSymlinks: false })) {
        if (signal?.aborted) throw new Error("Aborted");
        if (skipIgnored && rel.split(path.sep).some((seg) => IGNORED_DIRS.has(seg))) continue;
        scanned++;
        const abs = path.join(root, rel);
        let m = 0;
        try {
          m = fs.statSync(abs).mtimeMs;
        } catch {}
        hits.push({ p: abs, m });
        if (scanned > 20000) break;
      }
      hits.sort((a, b) => b.m - a.m);
      const shown = hits.slice(0, 200).map((h) => h.p);
      const more = hits.length > 200 ? `\n… ${hits.length - 200} more (refine the pattern)` : "";
      return {
        content: text(shown.length ? shown.join("\n") + more : "No files matched."),
        details: { count: hits.length },
      };
    },
  });
}

export function runProcess(cmd: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: getShellEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      if (out.length < 2_000_000) out += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (err.length < 20_000) err += d.toString();
    });
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== null && code > 1 && !out) reject(new Error(err.trim() || `${cmd} exited with code ${code}`));
      else resolve({ out, code });
    });
  });
}

export function createGrepTool(ctx: ToolContext): KestrelTool {
  return defineTool({
    name: "grep",
    label: "Search content",
    category: "read",
    description:
      "Search file contents with a regular expression (ripgrep syntax). Respects .gitignore. " +
      "output_mode: 'files_with_matches' (default, list files), 'content' (matching lines with line numbers), or 'count'. " +
      "Use glob (e.g. '*.ts') or type (e.g. 'py') to filter files.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression" }),
      path: Type.Optional(Type.String({ description: "File or directory to search (default: working directory)" })),
      glob: Type.Optional(Type.String({ description: "Glob filter for files" })),
      type: Type.Optional(Type.String({ description: "ripgrep file type (js, py, rust, go, ...)" })),
      output_mode: Type.Optional(Type.Union([Type.Literal("content"), Type.Literal("files_with_matches"), Type.Literal("count")])),
      case_insensitive: Type.Optional(Type.Boolean()),
      context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, description: "Lines of context around matches (content mode)" })),
      multiline: Type.Optional(Type.Boolean({ description: "Allow patterns to span lines" })),
      head_limit: Type.Optional(Type.Integer({ minimum: 1, description: "Limit output to first N lines/entries" })),
    }),
    async execute(_id, params, signal) {
      const target = resolvePath(ctx, params.path ?? ".");
      const mode = params.output_mode ?? "files_with_matches";
      const limit = params.head_limit ?? (mode === "content" ? 300 : 200);
      const rg = which("rg");
      let out: string;
      if (rg) {
        const args = ["--no-heading", "--color=never", "--max-columns=400", "--max-columns-preview"];
        if (mode === "files_with_matches") args.push("-l");
        else if (mode === "count") args.push("-c");
        else args.push("-n");
        if (params.case_insensitive) args.push("-i");
        if (params.multiline) args.push("-U", "--multiline-dotall");
        if (params.context && mode === "content") args.push("-C", String(params.context));
        if (params.glob) args.push("--glob", params.glob);
        if (params.type) args.push("--type", params.type);
        args.push("-e", params.pattern, target);
        out = (await runProcess(rg, args, ctx.cwd(), signal)).out;
      } else {
        const args = ["-rE", "--exclude-dir=node_modules", "--exclude-dir=.git"];
        if (mode === "files_with_matches") args.push("-l");
        else if (mode === "count") args.push("-c");
        else args.push("-n");
        if (params.case_insensitive) args.push("-i");
        if (params.glob) args.push(`--include=${params.glob}`);
        args.push(params.pattern, target);
        out = (await runProcess("grep", args, ctx.cwd(), signal)).out;
      }
      const lines = out.split("\n").filter(Boolean);
      const shown = lines.slice(0, limit);
      const more = lines.length > limit ? `\n… ${lines.length - limit} more lines (use head_limit or narrow the search)` : "";
      return {
        content: text(shown.length ? shown.join("\n") + more : "No matches found."),
        details: { count: lines.length, mode },
      };
    },
  });
}
