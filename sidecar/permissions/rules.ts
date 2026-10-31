// Matching commands and tools against the allowlists, and the arguments that turn a listed command risky.

export const MULTI_WORD = new Set(["git", "npm", "pnpm", "yarn", "bun", "npx", "cargo", "go", "docker", "kubectl", "brew", "uv", "pip", "pip3", "emo", "make", "gh", "lark-cli", "python", "python3", "node", "deno"]);

export const RUN_WORD = new Set(["run", "exec", "x"]);

/**
 * Entries that would let any command through: shells, interpreters, runners and tools that can send
 * data anywhere. With an auto-review model they are ignored so the reviewer still sees those commands.
 */
export const BROAD_WORDS = new Set([
  "bash", "sh", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "env", "sudo", "su", "doas", "xargs", "eval", "exec", "source", ".", "command", "builtin", "nohup", "time",
  "python", "python3", "node", "deno", "bun", "ruby", "perl", "php", "lua", "osascript", "awk", "gawk", "npx", "bunx", "pnpx", "uvx",
  "ssh", "scp", "sftp", "rsync", "curl", "wget", "nc", "ncat", "telnet", "ftp", "open",
  "git", "gh", "docker", "kubectl", "brew",
  "rm", "rmdir", "unlink", "shred", "mv", "cp", "ln", "chmod", "chown", "chflags", "dd", "truncate", "install", "tee", "sed", "kill", "killall", "pkill", "launchctl", "defaults", "security",
]);

export const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun", "cargo", "uv"]);

export const RUNNER_WORDS = new Set(["run", "exec", "x", "dlx", "script"]);

export function normalizeEntry(e: string): string {
  return e.trim().replace(/(:\*|\s\*)$/, "").trim();
}

export function isBroadEntry(entry: string): boolean {
  const words = normalizeEntry(entry).split(/\s+/).filter(Boolean);
  if (words.length === 1) return BROAD_WORDS.has(words[0]);
  if (words.length === 2) return PACKAGE_MANAGERS.has(words[0]) && RUNNER_WORDS.has(words[1]);
  return false;
}

export function segmentMatches(segment: string, entry: string): boolean {
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
export function riskyArgs(words: string[]): boolean {
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
