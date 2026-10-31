// Where a path really points and what it is: inside the project, a startup file, a credential, a critical folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOME, expandHome } from "../env";

export function realPath(p: string): string {
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

export const isUnder = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

export const lower = (p: string) => p.toLowerCase();

export const SHELL_STARTUP = [".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".profile", ".inputrc", ".gitconfig", ".gitignore_global", ".npmrc", ".yarnrc", ".netrc"];

/** Credentials: reading or changing these always goes to a person. */
export function sensitiveRoots(dataDir: string): string[] {
  const h = (...p: string[]) => path.join(HOME, ...p);
  return [
    h(".ssh"), h(".aws"), h(".gnupg"), h(".azure"), h(".kube"), h(".docker"), h(".config", "gcloud"), h(".config", "gh"), h(".config", "op"),
    h("Library", "Keychains"), h(".netrc"), h(".git-credentials"), h(".npmrc"), h(".pypirc"), h(".kestrel", "auth"), dataDir,
  ].filter(Boolean);
}

/** Places where a write would outlive the session or run later: startup files, hooks, agent config. */
export function protectedRoots(dataDir: string): string[] {
  const h = (...p: string[]) => path.join(HOME, ...p);
  return [
    ...sensitiveRoots(dataDir),
    ...SHELL_STARTUP.map((f) => h(f)),
    h(".config", "git"), h(".kestrel"), h("Library", "LaunchAgents"), h("Library", "Application Support", "com.apple.backgroundtaskmanagementagent"),
    "/Library/LaunchAgents", "/Library/LaunchDaemons", "/etc", "/System", "/usr/bin", "/usr/sbin", "/bin", "/sbin",
  ];
}

/** Anything inside a repository's own `.git` folder: history and settings that file operations should leave alone. */
export const GIT_DIR = /(^|\/)\.git(\/|$)/;

export const GIT_HOOKS = /(^|\/)\.git\/(hooks|config)(\/|$)|(^|\/)\.husky(\/|$)/;

export function matchesAny(abs: string, roots: string[]): string | null {
  const a = lower(abs);
  for (const r of roots) if (isUnder(a, lower(r))) return r;
  return null;
}

export function hit(abs: string, real: string, roots: string[]): boolean {
  return matchesAny(abs, roots) !== null || matchesAny(real, roots) !== null;
}

export class Paths {
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
