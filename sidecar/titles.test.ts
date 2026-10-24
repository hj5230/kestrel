import { describe, expect, test } from "bun:test";
import { clampTitle, TITLE_COLUMNS } from "./titles";

const cols = (s: string) => Array.from(s).reduce((n, c) => n + (/[\u2e80-\ua4cf\uff00-\uff60]/.test(c) ? 2 : 1), 0);

describe("clampTitle", () => {
  test("short titles pass through, minus decoration", () => {
    expect(clampTitle("Parser refactor")).toBe("Parser refactor");
    expect(clampTitle("“重构解析器”。")).toBe("重构解析器");
    expect(clampTitle("Title: Fix login timeout.")).toBe("Fix login timeout");
    expect(clampTitle("标题：修复登录超时")).toBe("修复登录超时");
    expect(clampTitle("## **Parser refactor**")).toBe("Parser refactor");
  });

  test("only the first line counts", () => {
    expect(clampTitle("\n\nParser refactor\nA longer explanation of why")).toBe("Parser refactor");
  });

  test("Chinese is cut at 12 characters", () => {
    const t = clampTitle("帮我梳理一下这个仓库的构建流程并且修复所有失败的测试用例");
    expect(t).toBe("帮我梳理一下这个仓库的构");
    expect(Array.from(t).length).toBe(12);
    expect(cols(t)).toBeLessThanOrEqual(TITLE_COLUMNS);
  });

  test("English is cut at a word boundary and never ends on a connector", () => {
    // "Refactor the configurati" is 24 columns; backing up to the space leaves "Refactor the", and "the" is dropped
    const t = clampTitle("Refactor the configuration parser for the new settings format");
    expect(t).toBe("Refactor");
    expect(clampTitle("Summary of the user profile and interests")).toBe("Summary of the user");
    expect(clampTitle("Summary of the user profile and interests").length).toBeLessThanOrEqual(TITLE_COLUMNS);
  });

  test("a very long single word is cut hard rather than dropped", () => {
    expect(clampTitle("Supercalifragilisticexpialidocious-and-more")).toBe("Supercalifragilisticexpi");
  });

  test("mixed Chinese and English counts columns, not characters", () => {
    const t = clampTitle("修复 Kestrel 的 session 标题过长问题");
    expect(cols(t)).toBeLessThanOrEqual(TITLE_COLUMNS);
    expect(t.startsWith("修复 Kestrel")).toBe(true);
  });

  test("an empty reply falls back, and the fallback is cut too", () => {
    expect(clampTitle("   \n ", "Fix the build")).toBe("Fix the build");
    expect(clampTitle("", "x".repeat(80)).length).toBe(TITLE_COLUMNS);
    expect(clampTitle("", "")).toBe("");
  });
});
