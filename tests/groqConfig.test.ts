import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRequestOptions,
  resolveMaxOutputTokens,
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_CEILING,
  DEFAULT_MODEL,
  VISION_MODEL,
  MAX_IMAGES_PER_REQUEST,
} from "../src/lib/groqConfig.ts";

test("request options cap output tokens", () => {
  const options = buildRequestOptions("system rules");

  assert.equal(options.maxCompletionTokens, MAX_OUTPUT_TOKENS);
  assert.equal(options.maxCompletionTokens, 1024);
  assert.ok(
    Number.isInteger(options.maxCompletionTokens) && options.maxCompletionTokens > 0
  );
});

test("request options accept a custom output token limit", () => {
  const options = buildRequestOptions("rules", undefined, 2048);
  assert.equal(options.maxCompletionTokens, 2048);
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

test("request options preserve the system instruction as the system message", () => {
  const options = buildRequestOptions("be helpful");
  assert.equal(options.systemMessage.role, "system");
  assert.equal(options.systemMessage.content, "be helpful");
});

test("request options preserve the abort signal", () => {
  const controller = new AbortController();
  const options = buildRequestOptions("rules", controller.signal);
  assert.equal(options.signal, controller.signal);
});

test("the configured provider models and image cap match the Groq docs", () => {
  assert.equal(DEFAULT_MODEL, "openai/gpt-oss-120b");
  assert.equal(VISION_MODEL, "qwen/qwen3.8-27b");
  assert.equal(MAX_IMAGES_PER_REQUEST, 3);
});
