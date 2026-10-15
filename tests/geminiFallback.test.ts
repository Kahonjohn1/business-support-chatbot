import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAbortError,
  isRecoverableGeminiError,
  readGeminiErrorStatus,
  resolveFallbackModel,
  runWithModelFallback,
} from "../src/lib/geminiFallback.ts";

const PRIMARY = "gemini-3.8-flash";
const FALLBACK = "gemini-3.7-flash";

function providerError(status: number): Error {
  const error = new Error(`provider failed with status ${status}`);
  error.name = "ApiError";
  (error as Error & { status?: number }).status = status;
  return error;
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

// Simulates one model call: throws the mapped error for a model, else resolves
// the mapped reply. Records the order of attempted models.
function fakeAttempt(
  results: Map<string, { reply?: string; error?: Error }>,
  calls: string[]
) {
  return async (model: string): Promise<string> => {
    calls.push(model);
    const result = results.get(model);
    if (!result) throw new Error(`unexpected model ${model}`);
    if (result.error) throw result.error;
    return result.reply ?? "";
  };
}

test("resolveFallbackModel returns a distinct fallback", () => {
  assert.equal(resolveFallbackModel(PRIMARY, FALLBACK), FALLBACK);
  assert.equal(resolveFallbackModel(PRIMARY, `  ${FALLBACK}  `), FALLBACK);
});

test("resolveFallbackModel rejects missing, blank, and duplicate values", () => {
  assert.equal(resolveFallbackModel(PRIMARY, undefined), null);
  assert.equal(resolveFallbackModel(PRIMARY, ""), null);
  assert.equal(resolveFallbackModel(PRIMARY, "   "), null);
  assert.equal(resolveFallbackModel(PRIMARY, PRIMARY), null);
  assert.equal(resolveFallbackModel(PRIMARY, ` ${PRIMARY} `), null);
});

test("readGeminiErrorStatus reads status and statusCode", () => {
  assert.equal(readGeminiErrorStatus(providerError(503)), 503);
  assert.equal(
    readGeminiErrorStatus({ statusCode: 429 } as unknown),
    429
  );
  assert.equal(readGeminiErrorStatus(new Error("network")), undefined);
  assert.equal(readGeminiErrorStatus(undefined), undefined);
});

test("isRecoverableGeminiError accepts transient/model failures", () => {
  for (const status of [408, 404, 409, 429, 500, 502, 503, 504]) {
    assert.equal(
      isRecoverableGeminiError(providerError(status)),
      true,
      `status ${status} should be recoverable`
    );
  }
  assert.equal(isRecoverableGeminiError(new Error("network down")), true);
});

test("isRecoverableGeminiError rejects invalid, auth, and payload errors", () => {
  for (const status of [400, 401, 403, 413, 415, 422]) {
    assert.equal(
      isRecoverableGeminiError(providerError(status)),
      false,
      `status ${status} should not be recoverable`
    );
  }
});

test("isRecoverableGeminiError rejects cancellations and timeouts", () => {
  assert.equal(isRecoverableGeminiError(namedError("AbortError")), false);
  assert.equal(isRecoverableGeminiError(namedError("TimeoutError")), false);
  assert.equal(isRecoverableGeminiError(namedError("APIUserAbortError")), false);
  assert.equal(
    isRecoverableGeminiError(namedError("APIConnectionTimeoutError")),
    false
  );
});

test("isAbortError matches fetch and SDK cancellation names", () => {
  assert.equal(isAbortError(namedError("AbortError")), true);
  assert.equal(isAbortError(namedError("APIUserAbortError")), true);
  assert.equal(isAbortError(namedError("APIConnectionTimeoutError")), true);
  assert.equal(isAbortError(new Error("boom")), false);
});

test("primary success does not call the fallback", async () => {
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([[PRIMARY, { reply: "primary answer" }]]),
    calls
  );

  const reply = await runWithModelFallback({
    primaryModel: PRIMARY,
    fallbackModel: FALLBACK,
    attempt,
  });

  assert.equal(reply, "primary answer");
  assert.deepEqual(calls, [PRIMARY]);
});

test("recoverable primary failure falls back and returns the fallback reply", async () => {
  const calls: string[] = [];
  const notices: Array<{ failedModel: string; nextModel: string; status?: number }> =
    [];
  const attempt = fakeAttempt(
    new Map([
      [PRIMARY, { error: providerError(503) }],
      [FALLBACK, { reply: "fallback answer" }],
    ]),
    calls
  );

  const reply = await runWithModelFallback({
    primaryModel: PRIMARY,
    fallbackModel: FALLBACK,
    attempt,
    onFallback: (notice) => notices.push(notice),
  });

  assert.equal(reply, "fallback answer");
  assert.deepEqual(calls, [PRIMARY, FALLBACK]);
  assert.deepEqual(notices, [
    { failedModel: PRIMARY, nextModel: FALLBACK, status: 503 },
  ]);
});

test("both models failing rejects with a single error and stops after two calls", async () => {
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([
      [PRIMARY, { error: providerError(500) }],
      [FALLBACK, { error: providerError(503) }],
    ]),
    calls
  );

  await assert.rejects(
    runWithModelFallback({
      primaryModel: PRIMARY,
      fallbackModel: FALLBACK,
      attempt,
    }),
    (error: unknown) => readGeminiErrorStatus(error) === 503
  );
  assert.deepEqual(calls, [PRIMARY, FALLBACK]);
});

test("invalid request errors do not trigger the fallback", async () => {
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([[PRIMARY, { error: providerError(400) }]]),
    calls
  );

  await assert.rejects(
    runWithModelFallback({
      primaryModel: PRIMARY,
      fallbackModel: FALLBACK,
      attempt,
      onFallback: () => assert.fail("fallback must not be announced"),
    }),
    (error: unknown) => readGeminiErrorStatus(error) === 400
  );
  assert.deepEqual(calls, [PRIMARY]);
});

test("authentication and permission errors do not trigger the fallback", async () => {
  for (const status of [401, 403]) {
    const calls: string[] = [];
    const attempt = fakeAttempt(
      new Map([[PRIMARY, { error: providerError(status) }]]),
      calls
    );

    await assert.rejects(
      runWithModelFallback({
        primaryModel: PRIMARY,
        fallbackModel: FALLBACK,
        attempt,
      })
    );
    assert.deepEqual(calls, [PRIMARY], `status ${status} must not retry`);
  }
});

test("a missing fallback never causes a duplicate attempt", async () => {
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([[PRIMARY, { error: providerError(503) }]]),
    calls
  );

  await assert.rejects(
    runWithModelFallback({
      primaryModel: PRIMARY,
      fallbackModel: null,
      attempt,
    })
  );
  assert.deepEqual(calls, [PRIMARY]);
});

test("an already-aborted operation does not attempt the fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([[PRIMARY, { error: providerError(503) }]]),
    calls
  );

  await assert.rejects(
    runWithModelFallback({
      primaryModel: PRIMARY,
      fallbackModel: FALLBACK,
      attempt,
      signal: controller.signal,
      onFallback: () => assert.fail("fallback must not run after abort"),
    })
  );
  assert.deepEqual(calls, [PRIMARY]);
});

test("the fallback attempt reuses the same attempt function for both models", async () => {
  const calls: string[] = [];
  const attempt = fakeAttempt(
    new Map([
      [PRIMARY, { error: providerError(429) }],
      [FALLBACK, { reply: "ok" }],
    ]),
    calls
  );

  const reply = await runWithModelFallback({
    primaryModel: PRIMARY,
    fallbackModel: FALLBACK,
    attempt,
  });

  assert.equal(reply, "ok");
  assert.deepEqual(calls, [PRIMARY, FALLBACK]);
});
