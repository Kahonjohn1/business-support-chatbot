import { test } from "node:test";
import assert from "node:assert/strict";

import { SUPPORT_SYSTEM_INSTRUCTION } from "../src/lib/systemInstruction.ts";
import {
  buildGenerationConfig,
  MAX_OUTPUT_TOKENS,
} from "../src/lib/geminiConfig.ts";
import {
  readGeminiErrorStatus,
  runWithModelFallback,
} from "../src/lib/geminiFallback.ts";

// These tests assert instruction *requirements* and the existing request-handling
// seams, not the exact wording of any generated reply. The live Gemini API is
// never called.

function providerError(status: number): Error {
  const error = new Error(`provider failed with status ${status}`);
  error.name = "ApiError";
  (error as Error & { status?: number }).status = status;
  return error;
}

// 1. A clear general technical question receives direct assistance.
test("clear questions are answered directly with actionable steps", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Answer clear questions directly/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /numbered instructions/i);
});

// 2. An ambiguous technical problem triggers a relevant clarification.
test("ambiguous problems trigger a focused clarifying question", () => {
  assert.match(
    SUPPORT_SYSTEM_INSTRUCTION,
    /focused follow-up question/i
  );
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /ambiguous|missing detail/i);
});

// 3. A troubleshooting conversation uses previously reported results.
test("troubleshooting uses previously reported outcomes and avoids repeats", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /reported (result|outcome)/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Do not repeat steps/i);
});

// 4. Unsupported company-specific information is not fabricated.
test("unsupported company-specific information is not fabricated", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Never invent Marque Technologies/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /verified information/i);
});

// 5. Unknown company contact details are not invented.
test("unknown company contact details are not invented", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /contact details/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /approved source/i);
});

// 6. The chatbot does not claim to perform actions it cannot perform.
test("the assistant does not claim actions it cannot perform", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Never claim to have inspected/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /support ticket/i);
});

// 7. Risky troubleshooting actions are handled cautiously.
test("risky troubleshooting is handled cautiously", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /delete data/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /reversible/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /disabling security protections/i);
});

// 8. Out-of-scope requests are redirected appropriately.
test("out-of-scope requests are redirected", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /outside your scope/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /redirect/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /general-purpose/i);
});

// 9. Existing cancellation and provider-error handling still works.
test("provider failures are classified for safe handling", () => {
  assert.equal(readGeminiErrorStatus(providerError(503)), 503);
  assert.equal(readGeminiErrorStatus(providerError(401)), 401);
});

test("cancellation prevents a fallback retry", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const attempt = async (model: string): Promise<string> => {
    calls.push(model);
    throw providerError(503);
  };

  await assert.rejects(
    runWithModelFallback({
      primaryModel: "primary-model",
      fallbackModel: "fallback-model",
      attempt,
      signal: controller.signal,
      onFallback: () => assert.fail("fallback must not run after cancellation"),
    })
  );
  assert.deepEqual(calls, ["primary-model"]);
});

// 10. Existing output limits and configuration behaviour remain intact.
test("the support instruction is wired with the output cap and abort signal", () => {
  const controller = new AbortController();
  const config = buildGenerationConfig(
    SUPPORT_SYSTEM_INSTRUCTION,
    controller.signal
  );

  assert.equal(config.systemInstruction, SUPPORT_SYSTEM_INSTRUCTION);
  assert.equal(config.abortSignal, controller.signal);
  assert.equal(config.maxOutputTokens, MAX_OUTPUT_TOKENS);
  assert.equal(MAX_OUTPUT_TOKENS, 1024);
});
