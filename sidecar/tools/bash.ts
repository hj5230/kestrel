import { spawn, type ChildProcess } from "node:child_process";
import { Type } from "typebox";
import type { BashDetails } from "../../shared/protocol";
import { getShellEnv, SHELL } from "../env";
import { text, defineTool, type HelmTool, type ToolContext } from "./types";

const MAX_OUTPUT = 30_000;

function clip(out: string): string {
  if (out.length <= MAX_OUTPUT) return out;
  const head = out.slice(0, 4000);
  const tail = out.slice(-(MAX_OUTPUT - 4000));
  return `${head}\n\n… [${out.length - MAX_OUTPUT} characters truncated] …\n\n${tail}`;
}

function shellEnv() {
  return { ...getShellEnv(), TERM: "dumb", NO_COLOR: "1", PAGER: "cat", GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" };
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  }, 2000).unref?.();
}

interface BackgroundShell {
  id: string;
  sessionId: string;
  command: string;
  child: ChildProcess;
  output: string;
  readOffset: number;
  exitCode: number | null;
  done: boolean;
  startedAt: number;
}

const background = new Map<string, BackgroundShell>();
let bgCounter = 0;

export function killSessionShells(sessionId: string) {
  for (const sh of background.values()) {
    if (sh.sessionId === sessionId && !sh.done) killTree(sh.child);
  }
}

export function killAllShells() {
  for (const sh of background.values()) if (!sh.done) killTree(sh.child);
}

export function createBashTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "bash",
    label: "Run command",
    category: "exec",
    executionMode: "sequential",
    description:
      `Execute a shell command with ${SHELL} in the working directory and return combined stdout/stderr. ` +
      "Each call starts a fresh shell in the working directory (use `cd dir && cmd` for other directories). " +
      "Default timeout is set by the user (max 600000 ms). Avoid interactive commands. " +
      "Use run_in_background for long-running processes such as dev servers, then poll with bash_output. " +
      "Prefer the read/grep/glob/ls tools over cat/grep/find for exploring files.",
    parameters: Type.Object({
      command: Type.String({ description: "The command to run" }),
      description: Type.Optional(Type.String({ description: "Short description of what the command does (5-10 words)" })),
      timeout: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000, description: "Timeout in milliseconds" })),
      run_in_background: Type.Optional(Type.Boolean({ description: "Run without waiting; returns a shell id" })),
    }),
    async execute(_id, params, signal, onUpdate) {
      const cwd = ctx.cwd();
      const started = Date.now();
      const child = spawn(SHELL, ["-c", params.command], {
        cwd,
        env: shellEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      if (params.run_in_background) {
        const id = `bg${++bgCounter}`;
        const sh: BackgroundShell = {
          id,
          sessionId: ctx.sessionId,
          command: params.command,
          child,
          output: "",
          readOffset: 0,
          exitCode: null,
          done: false,
          startedAt: started,
        };
        const push = (d: Buffer) => {
          sh.output += d.toString();
          if (sh.output.length > 2_000_000) {
            const drop = sh.output.length - 1_000_000;
            sh.output = sh.output.slice(drop);
            sh.readOffset = Math.max(0, sh.readOffset - drop);
          }
        };
        child.stdout!.on("data", push);
        child.stderr!.on("data", push);
        child.on("close", (code) => {
          sh.exitCode = code;
          sh.done = true;
        });
        child.on("error", (e) => {
          sh.output += `\n${e.message}`;
          sh.done = true;
        });
        background.set(id, sh);
        const details: BashDetails = { command: params.command, output: "", exitCode: null, durationMs: 0, background: id };
        return { content: text(`Started background shell ${id}. Use bash_output with shell_id "${id}" to read its output.`), details };
      }

      const timeoutMs = params.timeout ?? ctx.settings().bashTimeoutSec * 1000;
      let output = "";
      let timedOut = false;
      let lastPush = 0;
      const push = (d: Buffer) => {
        output += d.toString();
        if (output.length > 4_000_000) output = output.slice(-2_000_000);
        const now = Date.now();
        if (onUpdate && now - lastPush > 150) {
          lastPush = now;
          onUpdate({
            content: [],
            details: { command: params.command, output: output.slice(-8000), exitCode: null, durationMs: now - started } satisfies BashDetails,
          });
        }
      };
      child.stdout!.on("data", push);
      child.stderr!.on("data", push);
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      const onAbort = () => killTree(child);
      signal?.addEventListener("abort", onAbort, { once: true });

      const exitCode: number | null = await new Promise((resolve) => {
        child.on("close", (code) => resolve(code));
        child.on("error", (e) => {
          output += e.message;
          resolve(127);
        });
      });
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) throw new Error("Command aborted by user");

      const durationMs = Date.now() - started;
      const clipped = clip(output.trimEnd());
      const details: BashDetails = { command: params.command, output: clipped, exitCode, durationMs, timedOut };
      let body = clipped || "(no output)";
      if (timedOut) body += `\n\n[Command timed out after ${timeoutMs} ms and was killed]`;
      else if (exitCode !== 0) body += `\n\n[Exit code ${exitCode}]`;
      return { content: text(body), details };
    },
  });
}

export function createBashOutputTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "bash_output",
    label: "Read background output",
    category: "read",
    description: "Read new output from a background shell started with run_in_background, and whether it is still running.",
    parameters: Type.Object({
      shell_id: Type.String(),
      filter: Type.Optional(Type.String({ description: "Optional regex; only matching lines are returned" })),
    }),
    async execute(_id, params) {
      const sh = background.get(params.shell_id);
      if (!sh || sh.sessionId !== ctx.sessionId) throw new Error(`No background shell ${params.shell_id}`);
      let chunk = sh.output.slice(sh.readOffset);
      sh.readOffset = sh.output.length;
      if (params.filter) {
        const re = new RegExp(params.filter);
        chunk = chunk
          .split("\n")
          .filter((l) => re.test(l))
          .join("\n");
      }
      const status = sh.done ? `exited with code ${sh.exitCode}` : "running";
      return {
        content: text(`[${sh.id}: ${status}]\n${clip(chunk) || "(no new output)"}`),
        details: { command: sh.command, output: clip(chunk), exitCode: sh.exitCode, durationMs: Date.now() - sh.startedAt, background: sh.id },
      };
    },
  });
}

export function createKillShellTool(ctx: ToolContext): HelmTool {
  return defineTool({
    name: "kill_shell",
    label: "Stop background command",
    category: "exec",
    description: "Terminate a background shell by id.",
    parameters: Type.Object({ shell_id: Type.String() }),
    async execute(_id, params) {
      const sh = background.get(params.shell_id);
      if (!sh || sh.sessionId !== ctx.sessionId) throw new Error(`No background shell ${params.shell_id}`);
      if (!sh.done) killTree(sh.child);
      return { content: text(`Killed ${sh.id}`), details: {} };
    },
  });
}
