// The composer's own key edits, written as "text with a caret": | marks the caret, [ and ] a selection.
import { describe, expect, test } from "bun:test"
import { inCode, indent, newline, type Edit } from "./edits"

function parse(s: string): { text: string; a: number; b: number } {
  const caret = s.indexOf("|")
  if (caret >= 0) return { text: s.replace("|", ""), a: caret, b: caret }
  const a = s.indexOf("[")
  const b = s.indexOf("]") - 1
  return { text: s.replace("[", "").replace("]", ""), a, b }
}
function show(text: string, e: Edit | null): string | null {
  if (!e) return null
  const out = text.slice(0, e.from) + e.insert + text.slice(e.to)
  const [a, b] = e.sel
  return a === b ? out.slice(0, a) + "|" + out.slice(a) : out.slice(0, a) + "[" + out.slice(a, b) + "]" + out.slice(b)
}
const nl = (s: string) => {
  const { text, a, b } = parse(s)
  return show(text, newline(text, a, b))
}
const tab = (s: string, out = false) => {
  const { text, a, b } = parse(s)
  return show(text, indent(text, a, b, out))
}

describe("newline", () => {
  test("after an unclosed opening fence, the block opens with its close", () => {
    expect(nl("```ts|")).toBe("```ts\n|\n```")
    expect(nl("~~~|")).toBe("~~~\n|\n~~~")
    expect(nl("````|")).toBe("````\n|\n````")
  })
  test("after a fence that is already closed, a plain newline", () => {
    expect(nl("```ts|\na\n```")).toBe(null)
  })
  test("inside code, the line's indent carries over", () => {
    expect(nl("```\n  a|\n```")).toBe("```\n  a\n  |\n```")
    expect(nl("```\na|\n```")).toBe(null)
  })
  test("on the closing fence, nothing special", () => {
    expect(nl("```\na\n```|")).toBe(null)
  })
  test("a list goes on, numbered ones count up", () => {
    expect(nl("- a|")).toBe("- a\n- |")
    expect(nl("  * a|")).toBe("  * a\n  * |")
    expect(nl("1. a|")).toBe("1. a\n2. |")
    expect(nl("9) a|")).toBe("9) a\n10) |")
  })
  test("a task item starts an open task", () => {
    expect(nl("- [x] done|")).toBe("- [x] done\n- [ ] |")
  })
  test("an empty item ends the list", () => {
    expect(nl("- a\n- |")).toBe("- a\n|")
    expect(nl("- [ ] |")).toBe("|")
    expect(nl("1. |")).toBe("|")
  })
  test("a quote goes on, and an empty quote line ends it", () => {
    expect(nl("> a|")).toBe("> a\n> |")
    expect(nl("> |")).toBe("|")
    expect(nl("> - a|")).toBe("> - a\n> - |")
    expect(nl("> - |")).toBe("> |")
  })
  test("in the middle of a line, the rest moves down after the marker", () => {
    expect(nl("- ab|cd")).toBe("- ab\n- |cd")
  })
  test("before the marker, nothing special", () => {
    expect(nl("|- a")).toBe(null)
    expect(nl("-| a")).toBe(null)
  })
  test("plain text and a selection: nothing special", () => {
    expect(nl("hello|")).toBe(null)
    expect(nl("- [a]")).toBe(null)
  })
  test("a hyphenated word is not a list", () => {
    expect(nl("-abc|")).toBe(null)
  })
})

describe("indent", () => {
  test("a list item nests under the one above", () => {
    expect(tab("- a\n- b|")).toBe("- a\n  - b|")
    expect(tab("1. a\n2. b|")).toBe("1. a\n   2. b|")
  })
  test("and comes back out", () => {
    expect(tab("- a\n  - b|", true)).toBe("- a\n- b|")
  })
  test("a selection of items moves together", () => {
    expect(tab("- a\n[- b\n- c]")).toBe("- a\n[  - b\n  - c]")
  })
  test("an empty code line takes the indent too", () => {
    expect(tab("```\na\n|\n```")).toBe("```\na\n  |\n```")
  })
  test("code lines indent by two spaces and come back", () => {
    expect(tab("```\na|\n```")).toBe("```\n  a|\n```")
    expect(tab("```\n  a|\n```", true)).toBe("```\na|\n```")
  })
  test("plain text keeps Tab for moving focus", () => {
    expect(tab("hello|")).toBe(null)
    expect(tab("- a\nplain|")).toBe(null)
  })
  test("an item at the left can't come out further", () => {
    expect(tab("- a|", true)).toBe(null)
  })
})

describe("inCode", () => {
  test("the opening fence and the body count; the closing fence and after don't", () => {
    const t = "```\na\n```\nb"
    expect(inCode(t, 2)).toBe(true)
    expect(inCode(t, 5)).toBe(true)
    expect(inCode(t, 8)).toBe(false)
    expect(inCode(t, t.length)).toBe(false)
  })
  test("an unclosed block runs to the end", () => {
    expect(inCode("```\na", 5)).toBe(true)
  })
})
