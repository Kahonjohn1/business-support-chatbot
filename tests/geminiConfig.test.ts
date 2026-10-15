import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGenerationConfig,
  MAX_OUTPUT_TOKENS,
} from "../src/lib/geminiConfig.ts";

test("generation config caps output tokens", () => {
  const config = buildGenerationConfig("system rules");

  assert.equal(config.maxOutputTokens, MAX_OUTPUT_TOKENS);
  assert.equal(config.maxOutputTokens, 1024);
  assert.ok(
    Number.isInteger(config.maxOutputTokens) && (config.maxOutputTokens ?? 0) > 0
  );
});

test("generation config preserves the system instruction", () => {
  const config = buildGenerationConfig("be helpful");
  assert.equal(config.systemInstruction, "be helpful");
});

test("generation config preserves the abort signal", () => {
  const controller = new AbortController();
  const config = buildGenerationConfig("rules", controller.signal);
  assert.equal(config.abortSignal, controller.signal);
});
