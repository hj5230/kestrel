import { expect, test } from "bun:test";
import { modelDefaults } from "./providers";

test("ids the catalog does not know still get sensible windows", () => {
  expect(modelDefaults("openai-compatible", "claude-someday-9[1m]").contextWindow).toBe(1_000_000);
  expect(modelDefaults("openai-compatible", "claude-someday-9").contextWindow).toBe(200_000);
  expect(modelDefaults("openai-compatible", "my-local-llm").contextWindow).toBe(128_000);
  // the endpoint's own figure wins
  expect(modelDefaults("openai-compatible", "claude-someday-9[1m]", undefined, 64_000).contextWindow).toBe(64_000);
});
