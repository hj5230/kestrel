import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppSettings, ApprovalNote, PermissionMode } from "../shared/protocol";
import { HOME, expandHome } from "./env";
import { parseShell, type SimpleCommand } from "./shell";
import type { KestrelTool } from "./tools/types";

export const DEFAULT_BASH_WHITELIST = [
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "echo",
  "printf",
  "which",
  "whereis",
  "type",
  "whoami",
  "id",
  "date",
  "uname",
  "sw_vers",
  "hostname",
  "uptime",
  "printenv",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
  "md5",
  "shasum",
  "jq",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "find",
  "fd",
  "ps",
  "lsof",
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch --show-current",
  "git branch -a",
  "git branch --list",
  "git remote -v",
  "git rev-parse",
  "git ls-files",
  "git blame",
  "git describe",
  "git stash list",
  "git shortlog",
  "git reflog",
  "git config --get",
  "node --version",
  "node -v",
  "npm --version",
  "npm -v",
  "npm ls",
  "npm list",
  "npm view",
  "npm outdated",
  "pnpm --version",
  "pnpm ls",
  "bun --version",
  "python3 --version",
  "python --version",
  "cargo --version",
  "rustc --version",
  "go version",
  "tsc --version",
];

/** Added in the second revision of the defaults. Existing installs get these merged in once (db.ts). */
export const BASH_WHITELIST_ADDED_V2 = [
  // Read-only inspection: text, files and the system.
  "less",
  "more",
  "nl",
  "column",
  "fold",
  "rev",
  "tac",
  "paste",
  "join",
  "comm",
  "expand",
  "unexpand",
  "strings",
  "od",
  "hexdump",
  "xxd",
  "base64",
  "sha1sum",
  "sha256sum",
  "md5sum",
  "cksum",
  "seq",
  "true",
  "false",
  "test",
  "[",
  "locale",
  "tty",
  "groups",
  "arch",
  "nproc",
  "sysctl -n",
  "vm_stat",
  "top -l 1",
  "pgrep",
  "mdfind",
  "mdls",
  "otool -L",
  "lipo -info",
  "codesign -dv",
  "plutil -p",
  "plutil -lint",
  "man",
  "tldr",
  "help",
  "yq",
  "bat",
  "eza",
  "exa",
  "fzf --filter",
  "ast-grep",
  "tokei",
  "cloc",
  "scc",
  // Version control, read-only.
  "git grep",
  "git cat-file",
  "git ls-tree",
  "git merge-base",
  "git name-rev",
  "git count-objects",
  "git worktree list",
  "git tag --list",
  "git tag -l",
  "git show-ref",
  "git for-each-ref",
  "git rev-list",
  "git range-diff",
  "git whatchanged",
  "git check-ignore",
  "git check-attr",
  "git var",
  "git help",
  "git version",
  "git --version",
  "gh --version",
  "gh auth status",
  "gh pr list",
  "gh pr view",
  "gh pr diff",
  "gh pr checks",
  "gh pr status",
  "gh issue list",
  "gh issue view",
  "gh repo view",
  "gh run list",
  "gh run view",
  // Toolchains: versions, listings and checks that only print.
  "npm config get",
  "npm config list",
  "npm explain",
  "npm why",
  "npm pkg get",
  "npm root",
  "npm prefix",
  "npm bin",
  "pnpm list",
  "pnpm why",
  "pnpm outdated",
  "yarn --version",
  "yarn list",
  "yarn why",
  "yarn info",
  "bun pm ls",
  "deno --version",
  "pip --version",
  "pip3 --version",
  "pip list",
  "pip3 list",
  "pip show",
  "pip3 show",
  "pip freeze",
  "pip3 freeze",
  "uv --version",
  "uv pip list",
  "uv pip show",
  "poetry --version",
  "poetry show",
  "cargo tree",
  "cargo metadata",
  "cargo search",
  "rustup show",
  "rustup --version",
  "go env",
  "go list",
  "go doc",
  "java -version",
  "javac -version",
  "swift --version",
  "xcodebuild -version",
  "xcodebuild -list",
  "xcrun --show-sdk-path",
  "xcrun simctl list",
  "xcode-select -p",
  "docker --version",
  "docker ps",
  "docker images",
  "docker version",
  "brew --version",
  "brew list",
  "brew info",
  "brew --prefix",
  "brew deps",
  "brew outdated",
  "brew search",
  "cmake --version",
  // Linters that read config as data. ESLint, Prettier and mypy are left out: their configs and plugins are code.
  "tsc --noEmit",
  "biome check",
  "ruff check",
  "pyright",
  "shellcheck",
  "hadolint",
  "actionlint",
];

DEFAULT_BASH_WHITELIST.push(...BASH_WHITELIST_ADDED_V2);

// ---------- what a tool call needs ----------

export interface PermissionResult {
  /**
   * allow  — run it.
   * ask    — a person decides.
   * review — the auto-review model decides (auto mode only; the caller falls back to `ask` when
   *          no review model is set up or the review fails).
   * deny   — never run it.
   */
  action: "allow" | "deny" | "ask" | "review";
  reason?: string;
  /** Why a person is asked, when it is more than "nothing allowed this". */
  note?: ApprovalNote;
  kind: "bash" | "edit" | "tool";
  path: string | null;
  detail: string;
  suggestion: string | null;
}

export interface PermissionContext {
  /** Working directory of the session: the "project" for file edits. */
  cwd: string;
  /** Kestrel's own data directory (database with API keys, certificates). Never touched without asking. */
  dataDir: string;
  /** An auto-review model is configured, so unclear calls can be reviewed instead of asked. */
  reviewer: boolean;
}

// ---------- bash whitelist ----------

const MULTI_WORD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "cargo", "go", "docker", "kubectl", "brew", "uv", "pip", "pip3", "emo", "make", "gh", "lark-cli", "python", "python3", "node", "deno"]);
const RUN_WORD = new Set(["run", "exec", "x"]);

/**
 * Entries that would let any command through: shells, interpreters, runners and tools that can send
 * data anywhere. With an auto-review model they are ignored so the reviewer still sees those commands.
 */
const BROAD_WORDS = new Set([
  "bash", "sh", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "env", "sudo", "su", "doas", "xargs", "eval", "exec", "source", ".", "command", "builtin", "nohup", "time",
  "python", "python3", "node", "deno", "bun", "ruby", "perl", "php", "lua", "osascript", "awk", "gawk", "npx", "bunx", "pnpx", "uvx",
  "ssh", "scp", "sftp", "rsync", "curl", "wget", "nc", "ncat", "telnet", "ftp", "open",
  "git", "gh", "docker", "kubectl", "brew",
  "rm", "rmdir", "unlink", "shred", "mv", "cp", "ln", "chmod", "chown", "chflags", "dd", "truncate", "install", "tee", "sed", "kill", "killall", "pkill", "launchctl", "defaults", "security",
]);
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "cargo", "uv"]);
const RUNNER_WORDS = new Set(["run", "exec", "x", "dlx", "script"]);

function normalizeEntry(e: string): string {
  return e.trim().replace(/(:\*|\s\*)$/, "").trim();
}

export function isBroadEntry(entry: string): boolean {
  const words = normalizeEntry(entry).split(/\s+/).filter(Boolean);
  if (words.length === 1) return BROAD_WORDS.has(words[0]);
  if (words.length === 2) return PACKAGE_MANAGERS.has(words[0]) && RUNNER_WORDS.has(words[1]);
  return false;
}

function segmentMatches(segment: string, entry: string): boolean {
  const e = normalizeEntry(entry);
  if (!e) return false;
  return segment === e || segment.startsWith(e + " ");
}

export function toolWhitelisted(name: string, whitelist: string[]): boolean {
  return whitelist.some((e) => {
    const v = e.trim();
    if (!v) return false;
    if (v.endsWith("*")) return name.startsWith(v.slice(0, -1));
    return v === name;
  });
}

/** Flags that turn an otherwise read-only whitelisted command into one that writes or runs something. */
function riskyArgs(words: string[]): boolean {
  const [cmd, sub] = words;
  const args = words.slice(1);
  const has = (...flags: string[]) => args.some((a) => flags.some((f) => a === f || (f.startsWith("--") && a.startsWith(f + "="))));
  if (cmd === "find") return has("-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls");
  if (cmd === "rg") return has("--pre", "--pre-glob");
  if (cmd === "sort") return has("-o", "--output");
  if (cmd === "tree") return has("-o");
  if (cmd === "uniq") return args.filter((a) => !a.startsWith("-")).length > 1;
  if (cmd === "date") return has("-s", "--set");
  // A second file name is where xxd writes.
  if (cmd === "xxd") return has("-r", "-revert") || args.filter((a) => !a.startsWith("-")).length > 1;
  if (cmd === "base64") return has("-o", "--output");
  // A pager can write a log file; its interactive `!command` needs a terminal the agent's shell doesn't have.
  if (cmd === "less" || cmd === "more") return has("-o", "-O") || args.some((a) => a.startsWith("--log-file") || a.startsWith("--LOG-FILE"));
  if (cmd === "man") return has("-H", "-P", "--html", "--pager");
  if (cmd === "sysctl") return args.some((a) => a.includes("=")) || has("-w");
  if (cmd === "yq") return has("-i", "--inplace");
  if (cmd === "cloc" || cmd === "scc" || cmd === "tokei") return has("--report-file", "--out", "-o", "--output");
  if (cmd === "bat") return has("--pager");
  if (cmd === "ast-grep") return has("-U", "--update-all", "-r", "--rewrite", "-i", "--interactive");
  if (cmd === "fzf") return has("--bind", "--preview", "--execute");
  if (cmd === "biome") return has("--write", "--apply", "--apply-unsafe", "--fix");
  if (cmd === "ruff") return has("--fix", "--unsafe-fixes", "-w", "--watch");
  // Only `tsc --noEmit` is listed; anything that builds, watches or picks other output is asked.
  if (cmd === "tsc") return has("--build", "-b", "--watch", "-w", "--outDir", "--outFile", "--declarationDir");
  if (cmd === "plutil") return has("-convert", "-insert", "-replace", "-remove", "-o");
  if (cmd === "go" && sub === "env") return has("-w", "-u");
  if (cmd === "go") return has("-toolexec", "-exec", "-overlay", "-export");
  if (cmd === "codesign") return has("--extract-certificates");
  if (cmd === "npm" && sub === "config") return args.slice(1).some((a) => ["set", "delete", "edit", "fix"].includes(a));
  if (cmd === "npm" && sub === "pkg") return args.slice(1).some((a) => ["set", "delete", "fix"].includes(a));
  // Only viewing subcommands are listed; `--web` opens a browser.
  if (cmd === "gh") return has("--web", "-w", "--show-token", "-t");

  if (cmd === "git") {
    // --filters and --textconv run drivers named in .gitattributes, which a cloned repository controls.
    if (has("--output", "--ext-diff", "--textconv", "--filters", "--open-files-in-pager", "-O", "--upload-pack", "--exec")) return true;
    if (sub === "help") return has("--web", "-w", "--info", "-i");
    if (sub === "reflog") return args.slice(1).some((a) => a === "expire" || a === "delete");
    if (sub === "branch") return has("-d", "-D", "-m", "-M", "-c", "-C", "-f", "--force", "--delete", "--move", "--copy", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description");
  }
  return false;
}

// ---------- paths ----------

function realPath(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const r = fs.realpathSync(cur);
      return rest.length ? path.join(r, ...rest.reverse()) : r;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
  return p;
}

const isUnder = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const lower = (p: string) => p.toLowerCase();

const SHELL_STARTUP = [".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".profile", ".inputrc", ".gitconfig", ".gitignore_global", ".npmrc", ".yarnrc", ".netrc"];

/** Credentials: reading or changing these always goes to a person. */
function sensitiveRoots(dataDir: string): string[] {
  const h = (...p: string[]) => path.join(HOME, ...p);
  return [
    h(".ssh"), h(".aws"), h(".gnupg"), h(".azure"), h(".kube"), h(".docker"), h(".config", "gcloud"), h(".config", "gh"), h(".config", "op"),
    h("Library", "Keychains"), h(".netrc"), h(".git-credentials"), h(".npmrc"), h(".pypirc"), h(".kestrel", "auth"), dataDir,
  ].filter(Boolean);
}

/** Places where a write would outlive the session or run later: startup files, hooks, agent config. */
function protectedRoots(dataDir: string): string[] {
  const h = (...p: string[]) => path.join(HOME, ...p);
  return [
    ...sensitiveRoots(dataDir),
    ...SHELL_STARTUP.map((f) => h(f)),
    h(".config", "git"), h(".kestrel"), h("Library", "LaunchAgents"), h("Library", "Application Support", "com.apple.backgroundtaskmanagementagent"),
    "/Library/LaunchAgents", "/Library/LaunchDaemons", "/etc", "/System", "/usr/bin", "/usr/sbin", "/bin", "/sbin",
  ];
}

/** Anything inside a repository's own `.git` folder: history and settings that file operations should leave alone. */
const GIT_DIR = /(^|\/)\.git(\/|$)/;
const GIT_HOOKS = /(^|\/)\.git\/(hooks|config)(\/|$)|(^|\/)\.husky(\/|$)/;

function matchesAny(abs: string, roots: string[]): string | null {
  const a = lower(abs);
  for (const r of roots) if (isUnder(a, lower(r))) return r;
  return null;
}

function hit(abs: string, real: string, roots: string[]): boolean {
  return matchesAny(abs, roots) !== null || matchesAny(real, roots) !== null;
}

class Paths {
  readonly cwd: string;
  readonly cwdReal: string;
  readonly scopes: string[];
  private readonly uploads: string;
  private readonly sensitive: string[];
  private readonly protectedPaths: string[];

  constructor(cwd: string, dataDir: string) {
    this.cwd = cwd;
    this.cwdReal = realPath(cwd);
    this.scopes = [this.cwdReal, realPath(os.tmpdir()), "/private/tmp", "/tmp"];
    // The literal folder, not its realpath: resolving it would let a symlink placed at `uploads` move this exception onto whatever the link points at.
    this.uploads = path.join(realPath(dataDir), "uploads");
    this.sensitive = sensitiveRoots(dataDir);
    this.protectedPaths = protectedRoots(dataDir);
  }

  resolve(p: string): string {
    return path.resolve(this.cwd, expandHome(p.trim()) || ".");
  }

  /** Reading it would expose credentials. `.pub` keys are fine. */
  sensitiveRead(abs: string, real = realPath(abs)): boolean {
    if (/\.pub$/i.test(abs)) return false;
    // Only a file that really sits inside the uploads folder is exempt. A symlink inside it resolves to
    // somewhere else, so it falls through to the normal check instead of inheriting the exemption.
    if (isUnder(lower(real), lower(this.uploads))) return false;
    return hit(abs, real, this.sensitive);
  }

  /** Writing it could persist code or widen access (startup files, git hooks, agent config). */
  protectedWrite(abs: string, real = realPath(abs)): boolean {
    return hit(abs, real, this.protectedPaths) || GIT_HOOKS.test(abs) || GIT_HOOKS.test(real);
  }

  /** The file lives in the project (or temp space) once links are resolved. */
  inScope(real: string): boolean {
    return this.scopes.some((s) => isUnder(real, s));
  }

  /** Deleting this would be a disaster: `/`, the home folder, or a folder directly under either. */
  critical(abs: string): boolean {
    const a = path.resolve(abs);
    if (a === path.parse(a).root || a === HOME) return true;
    const parent = path.dirname(a);
    return parent === HOME || parent === path.parse(a).root;
  }
}

// ---------- bash analysis ----------

type Level = 0 | 1 | 2; // allow, unknown, force a person
interface Verdict {
  level: Level;
  note?: ApprovalNote;
}
const ALLOW: Verdict = { level: 0 };
const UNKNOWN: Verdict = { level: 1 };
const force = (code: ApprovalNote["code"], detail?: string): Verdict => ({ level: 2, note: { code, detail } });
const worse = (a: Verdict, b: Verdict) => (b.level > a.level ? b : a);

const UNSAFE_ENV = /^(PATH|IFS|SHELL|ENV|BASH_ENV|PS4|PROMPT_COMMAND|LD_.*|DYLD_.*|NODE_OPTIONS|NODE_PATH|PYTHON.*|RUBY.*|PERL.*|GIT_.*|PAGER|MANPAGER|MANOPT|LESS.*|EDITOR|VISUAL|BROWSER|NPM_CONFIG_.*|CARGO_.*|HOME|ZDOTDIR)$/i;
const SCOPE_OPS: Record<string, RegExp> = {
  mkdir: /^-[pv]+$/,
  touch: /^-[cam]+$/,
  rm: /^-[rRfvid]+$/,
  rmdir: /^-[pv]+$/,
  mv: /^-[fnvi]+$/,
  cp: /^-[rRfnvpaiL]+$/,
};
const DELETERS = new Set(["rm", "rmdir", "unlink", "shred"]);

interface Stripped {
  words: string[];
  dynamic: boolean[];
  glob: boolean[];
}

/** Drops `timeout 30`, `nice -n 5`, `nohup`, `time` in front of the real command. Null when it cannot tell. */
function stripWrappers(sc: SimpleCommand): Stripped | null {
  let i = 0;
  const w = sc.words;
  for (;;) {
    const cur = w[i];
    if (cur === "time" || cur === "nohup") {
      i++;
      if (cur === "time" && w[i] === "-p") i++;
    } else if (cur === "nice") {
      i++;
      if (w[i] === "-n") i += 2;
      else if (/^-\d+$/.test(w[i] ?? "")) i++;
    } else if (cur === "timeout") {
      i++;
      while (w[i]?.startsWith("-")) i += w[i] === "-k" || w[i] === "-s" ? 2 : 1;
      if (!/^\d+(\.\d+)?[smhd]?$/.test(w[i] ?? "")) return null;
      i++;
    } else break;
    if (i >= w.length) return null;
  }
  return { words: w.slice(i), dynamic: sc.dynamic.slice(i), glob: sc.glob.slice(i) };
}

function globPrefix(word: string): string {
  const m = /[*?[]/.exec(word);
  if (!m) return word;
  const head = word.slice(0, m.index);
  return head.endsWith("/") ? head : path.dirname(head + "x");
}

interface BashEnv {
  paths: Paths;
  whitelist: string[];
}

function judgeSimple(sc: SimpleCommand, env: BashEnv): Verdict {
  const { paths } = env;
  let v: Verdict = ALLOW;

  for (const e of sc.env) if (e.dynamic || UNSAFE_ENV.test(e.name)) return UNKNOWN;

  // redirections
  for (const r of sc.redirects) {
    if (r.dup || r.target === null) continue;
    if (r.dynamic) {
      v = worse(v, UNKNOWN);
      continue;
    }
    if (/^\/dev\/(null|stdout|stderr|tty)$/.test(r.target)) continue;
    const abs = paths.resolve(r.target);
    const real = realPath(abs);
    if (!r.write) {
      if (paths.sensitiveRead(abs, real)) v = worse(v, force("sensitive_read", r.target));
    } else if (paths.protectedWrite(abs, real)) v = worse(v, force("protected_path", r.target));
    else if (!paths.inScope(real)) v = worse(v, UNKNOWN);
  }

  if (!sc.words.length) return v;
  const stripped = stripWrappers(sc);
  if (!stripped) return worse(v, UNKNOWN);
  const { words, dynamic, glob } = stripped;
  const name = words[0];
  if (dynamic[0] || glob[0] || name.includes("/")) return worse(v, UNKNOWN);

  // Arguments that are paths: credentials stay off limits; deleting or moving a critical folder is a human call.
  const args = words.slice(1);
  let afterDashDash = false;
  const targets: { i: number; w: string }[] = [];
  args.forEach((a, k) => {
    if (a === "--" && !afterDashDash) {
      afterDashDash = true;
      return;
    }
    if (!afterDashDash && a.startsWith("-")) {
      const eq = a.indexOf("=");
      if (eq > 0 && !dynamic[k + 1]) {
        const abs = paths.resolve(a.slice(eq + 1));
        if (paths.sensitiveRead(abs)) v = worse(v, force("sensitive_read", a.slice(eq + 1)));
      }
      return;
    }
    if (dynamic[k + 1]) return;
    targets.push({ i: k + 1, w: a });
    const abs = paths.resolve(glob[k + 1] ? globPrefix(a) : a);
    if (paths.sensitiveRead(abs)) v = worse(v, force("sensitive_read", a));
  });

  const deleting = DELETERS.has(name);
  if (deleting || name === "mv") {
    for (const t of targets) {
      const abs = paths.resolve(glob[t.i] ? globPrefix(t.w) : t.w);
      if (paths.critical(abs)) v = worse(v, force("critical_delete", t.w));
      else if (paths.protectedWrite(abs)) v = worse(v, force("protected_path", t.w));
    }
  }
  if (v.level === 2) return v;

  if (name === "cd" || name === "pushd" || name === "popd") return v;

  // whitelist (the built-in list plus what the user chose to always allow)
  const segment = words.join(" ");
  if (!riskyArgs(words) && env.whitelist.some((e) => segmentMatches(segment, e))) return v;

  // file operations inside the project
  const flagRe = SCOPE_OPS[name];
  if (flagRe) {
    let ok = targets.length > 0;
    let seenDashDash = false;
    for (let k = 0; k < args.length && ok; k++) {
      const a = args[k];
      if (a === "--") seenDashDash = true;
      else if (!seenDashDash && a.startsWith("-")) ok = flagRe.test(a);
      else if (dynamic[k + 1]) ok = false;
      else {
        const abs = paths.resolve(glob[k + 1] ? globPrefix(a) : a);
        const real = realPath(abs);
        ok = paths.inScope(real) && !paths.protectedWrite(abs, real) && !paths.critical(abs) && !GIT_DIR.test(abs) && !GIT_DIR.test(real);
        if (ok && (name === "rm" || name === "rmdir") && (abs === paths.cwd || real === paths.cwdReal)) ok = false;
      }
    }
    if (ok) return v;
  }
  return worse(v, UNKNOWN);
}

function analyzeBash(cmd: string, ctx: PermissionContext, whitelist: string[]): Verdict {
  if (!cmd.trim()) return UNKNOWN;
  const parsed = parseShell(cmd);
  if (!parsed || !parsed.length) return UNKNOWN;
  const env: BashEnv = { paths: new Paths(ctx.cwd, ctx.dataDir), whitelist };
  let v: Verdict = ALLOW;
  for (const sc of parsed) {
    v = worse(v, judgeSimple(sc, env));
    if (v.level === 2) break;
  }
  return v;
}

/** The prefix offered under "always allow": the first command that is not just `cd`, up to its subcommand. */
export function suggestBashPrefix(cmd: string): string | null {
  const parsed = parseShell(cmd);
  let words: string[] | undefined;
  if (parsed) {
    for (const sc of parsed) {
      const stripped = stripWrappers(sc);
      const w = stripped?.words ?? [];
      if (w.length && !["cd", "pushd", "popd"].includes(w[0])) {
        words = w;
        break;
      }
    }
  } else {
    words = cmd.split(/&&|\|\||;|\||\n/)[0]?.trim().replace(/^(\w+=\S*\s+)+/, "").split(/\s+/);
  }
  if (!words?.length || !words[0]) return null;
  let prefix: string;
  if (MULTI_WORD.has(words[0]) && words[1] && !words[1].startsWith("-")) {
    prefix = RUN_WORD.has(words[1]) && words[2] && !words[2].startsWith("-") ? words.slice(0, 3).join(" ") : words.slice(0, 2).join(" ");
  } else prefix = words[0];
  // A prefix that would let any command through is no use as a rule.
  return isBroadEntry(prefix) ? null : prefix;
}

// ---------- decision ----------

const pathArg = (args: any): string | undefined => (typeof args?.path === "string" ? args.path : undefined);

/** A page fetch with nothing in the URL that could carry data out. */
function plainUrl(raw: unknown): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : "https://" + String(raw));
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && !u.search;
  } catch {
    return false;
  }
}

export function evaluatePermission(tool: KestrelTool, args: any, mode: PermissionMode, settings: AppSettings, ctx: PermissionContext): PermissionResult {
  const base = (kind: PermissionResult["kind"], detail: string, suggestion: string | null, path: string | null = null) => ({ kind, detail, suggestion, path });
  let info: Omit<PermissionResult, "action" | "reason">;
  if (tool.name === "bash") {
    const cmd = String(args?.command ?? "");
    info = base("bash", cmd, suggestBashPrefix(cmd));
  } else if (tool.category === "edit") {
    const detail = tool.name === "write" ? String(args?.content ?? "").slice(0, 6000) : "";
    info = base("edit", detail, null, String(args?.path ?? ""));
  } else {
    info = base("tool", JSON.stringify(args ?? {}, null, 2).slice(0, 4000), tool.category === "mcp" ? tool.name : null);
  }
  const res = (action: PermissionResult["action"], extra: { reason?: string; note?: ApprovalNote } = {}): PermissionResult => ({ action, ...extra, ...info });
  // Unclear calls: the reviewer when there is one, otherwise a person.
  const unclear = () => (mode === "auto" && ctx.reviewer ? res("review") : res("ask"));

  if (mode === "bypass") return res("allow");

  const paths = new Paths(ctx.cwd, ctx.dataDir);
  const target = pathArg(args);

  if (tool.category === "meta") return res("allow");
  if (tool.category === "read") {
    if (target !== undefined) {
      const abs = paths.resolve(target);
      if (paths.sensitiveRead(abs)) return res("ask", { note: { code: "sensitive_read", detail: target } });
    }
    return res("allow");
  }
  if (tool.category === "network") {
    if (mode === "auto" && ctx.reviewer && tool.name === "web_fetch" && !plainUrl(args?.url)) return res("review");
    return res("allow");
  }

  if (tool.category === "edit") {
    const abs = paths.resolve(target ?? "");
    const real = realPath(abs);
    if (paths.protectedWrite(abs, real)) return res("ask", { note: { code: "protected_path", detail: target } });
    if (mode === "manual") return res("ask");
    if (paths.inScope(real)) return res("allow");
    return mode === "auto" ? unclear() : res("ask", { note: { code: "outside_project", detail: target } });
  }

  if (mode === "auto") {
    if (tool.name === "kill_shell") return res("allow");
    if (tool.name === "bash") {
      // With a reviewer, rules that allow any command (`bash`, `python3`, `npm run`, …) are ignored so it still sees those.
      const whitelist = ctx.reviewer ? settings.bashWhitelist.filter((e) => !isBroadEntry(e)) : settings.bashWhitelist;
      const v = analyzeBash(String(args?.command ?? ""), ctx, whitelist);
      if (v.level === 0) return res("allow");
      if (v.level === 2) return res("ask", { note: v.note });
      return unclear();
    }
    if (tool.category === "mcp") return toolWhitelisted(tool.name, settings.toolWhitelist) ? res("allow") : unclear();
  }
  return res("ask");
}
