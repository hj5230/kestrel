import { describe, expect, test } from "bun:test";
import { parseShell } from "./shell";

const words = (cmd: string) => parseShell(cmd)?.map((c) => c.words);

describe("parseShell", () => {
  test("splits on every separator", () => {
    expect(words("a && b || c; d | e |& f & g\nh")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
  });

  test("removes quotes and keeps operators inside them", () => {
    expect(words(`echo "a && b" 'c | d' e\\ f`)).toEqual([["echo", "a && b", "c | d", "e f"]]);
  });

  test("reads env assignments before the command", () => {
    const [c] = parseShell("FOO=1 BAR='x y' make test")!;
    expect(c.env.map((e) => [e.name, e.value])).toEqual([
      ["FOO", "1"],
      ["BAR", "x y"],
    ]);
    expect(c.words).toEqual(["make", "test"]);
  });

  test("marks variables and globs", () => {
    const [c] = parseShell(`rm -rf "$DIR"/* '$HOME' ~/x`)!;
    expect(c.dynamic).toEqual([false, false, true, false, false]);
    expect(c.glob).toEqual([false, false, true, false, false]);
  });

  test("reads redirections", () => {
    const [c] = parseShell("cmd 2>&1 >/dev/null >> log.txt < in &> all")!;
    expect(c.words).toEqual(["cmd"]);
    expect(c.redirects.map((r) => [r.op, r.target, r.write, r.dup])).toEqual([
      [">&", null, true, true],
      [">", "/dev/null", true, false],
      [">>", "log.txt", true, false],
      ["<", "in", false, false],
      ["&>", "all", true, false],
    ]);
  });

  test("a redirect without a target fails", () => {
    expect(parseShell("echo hi >")).toBeNull();
    expect(parseShell("echo hi > ;")).toBeNull();
  });

  test("a leading redirect is its own command", () => {
    const [c] = parseShell("> out.txt")!;
    expect(c.words).toEqual([]);
    expect(c.redirects[0].target).toBe("out.txt");
  });

  test("comments are dropped, # inside a word is kept", () => {
    expect(words("ls # && rm -rf /\npwd")).toEqual([["ls"], ["pwd"]]);
    expect(words("echo a#b")).toEqual([["echo", "a#b"]]);
  });

  test.each([
    "echo $(whoami)",
    'echo "$(whoami)"',
    "echo `whoami`",
    'echo "`whoami`"',
    "echo $((1+2))",
    "echo $'a\\nb'",
    "diff <(ls a) <(ls b)",
    "(cd x && ls)",
    "{ ls; }",
    "cat <<EOF\nhi\nEOF",
    "cat <<-EOF\nhi\nEOF",
    "for f in *; do rm $f; done",
    "if true; then ls; fi",
    "case x in x) ls;; esac",
    "echo 'unterminated",
    'echo "unterminated',
    "a=(1 2)",
    "! ls",
    "[[ -f x ]] && ls",
    "ls ;;",
  ])("refuses %j", (cmd) => {
    expect(parseShell(cmd)).toBeNull();
  });

  test("here-strings are plain input", () => {
    const [c] = parseShell("grep x <<< hello")!;
    expect(c.redirects[0]).toMatchObject({ op: "<<<", write: false, target: "hello" });
  });

  test("line continuation joins words", () => {
    expect(words("ls \\\n -la")).toEqual([["ls", "-la"]]);
  });
});
