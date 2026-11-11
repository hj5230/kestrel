// The highlighted copy must say exactly what the textarea says, one block per line, or the caret drifts.
import { describe, expect, test } from "bun:test"
import { highlightMarkdownSource, lineRoles } from "./source"

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
/** The lines the copy shows, read back as text the way the browser lays them out. */
const shown = (html: string) =>
  [...html.matchAll(/<div class="(md-line[^"]*)">(.*?)<\/div>/g)].map((m) => ({ cls: m[1], text: unesc(m[2].replace(/<br>/g, "").replace(/<[^>]+>/g, "")) }))

const CASES: Record<string, string> = {
  empty: "",
  plain: "hello",
  "trailing newline": "hello\n",
  "blank lines": "a\n\n\nb\n\n",
  heading: "# Title\n## Sub *it*\n#nospace",
  emphasis: "**bold** *it* _it_ __bold__ ~~gone~~ snake_case_name 2*3*4",
  "inline code": "use `a` and ``b ` c`` and ```x```",
  "unclosed tick": "a ` b",
  escapes: "\\*not em\\* and \\`tick",
  links: "[label](https://x.y) and https://a.b/c?d=1.",
  html: "<b>x</b> & \"q\"",
  lists: "- a\n  - b\n1. one\n2) two\n- [ ] todo\n- [x] done\n* star\n+ plus",
  quote: "> a\n> > nested **b**\n>",
  rule: "---\n***\n___",
  table: "| a | b |\n|---|:-:|\n| `x` | **y** |",
  "fence closed": "```ts\nconst a = 1\n```\nafter",
  "fence unclosed": "```\ncode",
  "fence then text": "```ts\nconst\n```\n",
  "tilde fence": "~~~\n```\n~~~",
  "longer close": "````\n```\n````",
  "fence with indent": "   ```js\n x\n   ```",
  "two blocks": "```\na\n```\n```\nb\n```",
  cjk: "中文 **加粗** `代码`\n> 引用",
  emoji: "👍 *ok* 🎉",
  "long line": "x".repeat(400),
}

describe("highlightMarkdownSource", () => {
  for (const [name, src] of Object.entries(CASES)) {
    test(`${name}: one block per line, same text`, () => {
      const lines = shown(highlightMarkdownSource(src))
      expect(lines.map((l) => l.text)).toEqual(src.split("\n"))
    })
  }

  test("an empty line still takes a line", () => {
    expect(highlightMarkdownSource("a\n")).toBe('<div class="md-line">a</div><div class="md-line"><br></div>')
  })

  test("a code block's lines, fences included, sit in one framed box", () => {
    expect(highlightMarkdownSource("x\n```ts\nconst\n```\ny")).toBe(
      '<div class="md-line">x</div><div class="md-codeblock">' +
        '<div class="md-line md-codeline"><span class="md-mark">```</span><span class="md-info">ts</span></div>' +
        '<div class="md-line md-codeline">const</div>' +
        '<div class="md-line md-codeline"><span class="md-mark">```</span></div>' +
        '</div><div class="md-line">y</div>',
    )
  })

  test("an unclosed block runs to the last line", () => {
    expect(highlightMarkdownSource("```\na")).toMatch(/^<div class="md-codeblock">.*<\/div><\/div>$/)
    expect(shown(highlightMarkdownSource("```\na")).map((l) => l.cls)).toEqual(["md-line md-codeline", "md-line md-codeline"])
  })

  test("blocks next to each other are separate boxes", () => {
    expect(highlightMarkdownSource("```\na\n```\n```\nb\n```").match(/md-codeblock/g)).toHaveLength(2)
  })

  test("Markdown inside code is left alone", () => {
    expect(highlightMarkdownSource("```\n**a** <b>\n```")).toContain('<div class="md-line md-codeline">**a** &lt;b&gt;</div>')
  })

  test("words with underscores are not emphasis", () => {
    expect(highlightMarkdownSource("snake_case_name")).not.toContain("md-em")
    expect(highlightMarkdownSource("_it_")).toContain("md-em")
  })

  test("headings, quotes, tables and rules mark their line", () => {
    expect(shown(highlightMarkdownSource("# a\n> b\n| c |\n---")).map((l) => l.cls)).toEqual(["md-line md-h", "md-line md-quote", "md-line md-table", "md-line md-rule"])
  })
})

describe("lineRoles", () => {
  test("a closing fence must be at least as long and the same character", () => {
    expect(lineRoles(["````", "```", "````"]).map((l) => l.role)).toEqual(["open", "body", "close"])
    expect(lineRoles(["~~~", "```", "~~~"]).map((l) => l.role)).toEqual(["open", "body", "close"])
  })

  test("a closing fence takes nothing after it", () => {
    expect(lineRoles(["```", "``` js"]).map((l) => l.role)).toEqual(["open", "body"])
  })

  test("backticks after the fence make it inline code, not a fence", () => {
    expect(lineRoles(["```a```"]).map((l) => l.role)).toEqual(["text"])
  })

  test("the opening fence knows whether it is closed", () => {
    expect(lineRoles(["```", "a"])[0].closed).toBe(false)
    expect(lineRoles(["```", "a", "```"])[0].closed).toBe(true)
  })
})
