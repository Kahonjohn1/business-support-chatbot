import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildGenerationConfig,
  resolveMaxOutputTokens,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
} from "../src/lib/geminiConfig.ts";

test("generation config caps output tokens", () => {
  const config = buildGenerationConfig("system rules");

  assert.equal(config.maxOutputTokens, MAX_OUTPUT_TOKENS);
  assert.equal(config.maxOutputTokens, 1024);
  assert.ok(
    Number.isInteger(config.maxOutputTokens) && (config.maxOutputTokens ?? 0) > 0
  );
});

test("generation config accepts a custom output token limit", () => {
  const config = buildGenerationConfig("rules", undefined, 2048);
  assert.equal(config.maxOutputTokens, 2048);
});

test("resolveMaxOutputTokens falls back to the default for invalid input", () => {
  assert.equal(resolveMaxOutputTokens(undefined), MAX_OUTPUT_TOKENS);
  assert.equal(resolveMaxOutputTokens(""), MAX_OUTPUT_TOKENS);
  assert.equal(resolveMaxOutputTokens("not-a-number"), MAX_OUTPUT_TOKENS);
  assert.equal(resolveMaxOutputTokens("0"), MAX_OUTPUT_TOKENS);
  assert.equal(resolveMaxOutputTokens("-5"), MAX_OUTPUT_TOKENS);
});

test("resolveMaxOutputTokens parses and floors valid input", () => {
  assert.equal(resolveMaxOutputTokens("2048"), 2048);
  assert.equal(resolveMaxOutputTokens("1500.9"), 1500);
});

test("resolveMaxOutputTokens clamps input above the ceiling", () => {
  assert.equal(
    resolveMaxOutputTokens(String(MAX_OUTPUT_TOKENS_CEILING + 1000)),
    MAX_OUTPUT_TOKENS_CEILING
  );
  assert.equal(resolveMaxOutputTokens(1_000_000), MAX_OUTPUT_TOKENS_CEILING);
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
