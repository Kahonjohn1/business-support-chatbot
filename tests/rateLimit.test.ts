import { test } from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../src/lib/rateLimit.ts";

test("allows requests up to the limit within the window", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });

  const first = limiter.check("client", 1000);
  const second = limiter.check("client", 1100);
  const third = limiter.check("client", 1200);

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 2);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 1);
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);
});

test("blocks requests beyond the limit and reports a retry delay", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  limiter.check("client", 1000);
  limiter.check("client", 1000);

  const blocked = limiter.check("client", 1000);

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("resets once the window has elapsed", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.check("client", 1000).allowed, true);
  assert.equal(limiter.check("client", 1500).allowed, false);
  assert.equal(limiter.check("client", 2001).allowed, true);
});

test("tracks each key independently", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.check("a", 1000).allowed, true);
  assert.equal(limiter.check("b", 1000).allowed, true);
  assert.equal(limiter.check("a", 1000).allowed, false);
  assert.equal(limiter.check("b", 1000).allowed, false);
});

test("clamps a non-positive limit to at least one request", () => {
  const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });
  assert.equal(limiter.check("client", 1000).allowed, true);
  assert.equal(limiter.check("client", 1000).allowed, false);
});
