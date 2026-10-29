// Delayed host work must never publish into the newly selected connection.
import { expect, test } from "bun:test";
import { ConnectionGeneration } from "../src/lib/connection-generation";

test("switching invalidates delayed responses and stream completions", async () => {
  const generation = new ConnectionGeneration();
  const a = generation.capture();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let shown = "B";
  const response = delayed.then(() => { if (generation.current(a)) shown = "A"; });
  generation.invalidate();
  const b = generation.capture();
  release();
  await response;
  expect(shown).toBe("B");
  expect(generation.current(a)).toBe(false);
  expect(generation.current(b)).toBe(true);
});
