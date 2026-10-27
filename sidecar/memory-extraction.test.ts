// Regress the actual Kiro/Haiku answer shape without weakening extraction validation.
import { expect, test } from "bun:test";
import { parseMemoryExtraction } from "./memory-extraction";

test("memory extraction accepts raw JSON and a single fenced result with commentary", () => {
  const expected = { notes: [] };
  expect(parseMemoryExtraction('{"notes":[]}')).toEqual(expected);
  expect(parseMemoryExtraction('```json\n{"notes":[]}\n```')).toEqual(expected);
  expect(parseMemoryExtraction('I reviewed the message.\n```json\n{"notes":[]}\n```\nThe request contains no personal facts.')).toEqual(expected);
});

test("JSON strings are parsed intact instead of scanning braces inside the content", () => {
  const data = { notes: [{ content: 'Quoted {text} and "braces"' }] };
  expect(parseMemoryExtraction("```json\n" + JSON.stringify(data) + "\n```\nExplanation.")).toEqual(data);
});

test("ambiguous, malformed and non-JSON answers stay errors", () => {
  expect(() => parseMemoryExtraction('```json\n{"notes":[]}\n```\n```json\n{"notes":[{}]}\n```')).toThrow("multiple JSON blocks");
  expect(() => parseMemoryExtraction('```json\n{"notes":\n```')).toThrow();
  expect(() => parseMemoryExtraction("No useful facts.")).toThrow();
});
