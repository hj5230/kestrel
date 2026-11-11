// Judging a shell command: unwrap wrappers and env prefixes, then rate each simple command in the chain.
import path from "node:path";
import type { ApprovalNote } from "../../shared/protocol";
import { parseShell, type SimpleCommand } from "../shell";
import { realPath, GIT_DIR, Paths } from "./paths";
import type { PermissionContext } from "../permissions";
import { MULTI_WORD, RUN_WORD, RUNS_OTHER_CODE, isBroadEntry, segmentMatches, riskyArgs } from "./rules";

export type Level = 0 | 1 | 2; // allow, unknown, force a person

export interface Verdict {
  level: Level;
  note?: ApprovalNote;
}

export const ALLOW: Verdict = { level: 0 };

export const UNKNOWN: Verdict = { level: 1 };

export const force = (code: ApprovalNote["code"], detail?: string): Verdict => ({ level: 2, note: { code, detail } });

export const worse = (a: Verdict, b: Verdict) => (b.level > a.level ? b : a);

export const UNSAFE_ENV = /^(PATH|IFS|SHELL|ENV|BASH_ENV|PS4|PROMPT_COMMAND|LD_.*|DYLD_.*|NODE_OPTIONS|NODE_PATH|PYTHON.*|RUBY.*|PERL.*|GIT_.*|PAGER|MANPAGER|MANOPT|LESS.*|EDITOR|VISUAL|BROWSER|NPM_CONFIG_.*|CARGO_.*|HOME|ZDOTDIR)$/i;

export const SCOPE_OPS: Record<string, RegExp> = {
  mkdir: /^-[pv]+$/,
  touch: /^-[cam]+$/,
  rm: /^-[rRfvid]+$/,
  rmdir: /^-[pv]+$/,
  mv: /^-[fnvi]+$/,
  cp: /^-[rRfnvpaiL]+$/,
};

export const DELETERS = new Set(["rm", "rmdir", "unlink", "shred"]);

export interface Stripped {
  words: string[];
  dynamic: boolean[];
  glob: boolean[];
}

/** Drops `timeout 30`, `nice -n 5`, `nohup`, `time` in front of the real command. Null when it cannot tell. */
export function stripWrappers(sc: SimpleCommand): Stripped | null {
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

export function globPrefix(word: string): string {
  const m = /[*?[]/.exec(word);
  if (!m) return word;
  const head = word.slice(0, m.index);
  return head.endsWith("/") ? head : path.dirname(head + "x");
}

export interface BashEnv {
  paths: Paths;
  whitelist: string[];
}

export function judgeSimple(sc: SimpleCommand, env: BashEnv): Verdict {
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

export function analyzeBash(cmd: string, ctx: PermissionContext, whitelist: string[]): Verdict {
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
  if (!isBroadEntry(prefix)) return prefix;
  // A prefix that would let any command through is no use as a rule; the exact command line can be,
  // unless it runs code that lives elsewhere.
  return RUNS_OTHER_CODE.has(words[0]) ? null : "=" + words.join(" ");
}
