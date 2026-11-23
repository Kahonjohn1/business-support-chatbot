import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  createLocalRateLimitStore,
  type RateLimitStore,
} from "../src/lib/rateLimit.ts";
import {
  enforceRateLimit,
  resetRateLimitStore,
  setRateLimitStore,
  type RateLimitPolicy,
} from "../src/lib/requestRateLimit.ts";

const POLICY: RateLimitPolicy = {
  name: "test-policy",
  limit: 1,
  windowMs: 60_000,
};

afterEach(() => {
  resetRateLimitStore();
  delete process.env.TRUST_PROXY;
});

test("distributed rate-limit helper enforces the configured limit", async () => {
  setRateLimitStore(createLocalRateLimitStore());
  const request = new Request("https://example.test/api");

  assert.equal(await enforceRateLimit(request, POLICY), null);
  const blocked = await enforceRateLimit(request, POLICY);
  assert.ok(blocked);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
});

test("rate-limit store failures fail closed", async () => {
  const unavailable: RateLimitStore = {
    async consume() {
      throw new Error("store unavailable");
    },
  };
  setRateLimitStore(unavailable);

  const blocked = await enforceRateLimit(new Request("https://example.test/api"), POLICY);
  assert.ok(blocked);
  assert.equal(blocked.status, 503);
});

test("proxy headers are used only when explicitly trusted", async () => {
  const keys: string[] = [];
  setRateLimitStore({
    async consume(key) {
      keys.push(key);
      return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
    },
  });

  const request = new Request("https://example.test/api", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  process.env.TRUST_PROXY = "1";
  await enforceRateLimit(request, POLICY);
  const trustedKey = keys[0]!;

  delete process.env.TRUST_PROXY;
  await enforceRateLimit(request, POLICY);
  assert.notEqual(keys[0], keys[1]);
  assert.ok(trustedKey && keys[1]);
});
