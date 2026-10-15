// Best-effort, process-local, fixed-window rate limiter.
//
// IMPORTANT LIMITATION: the counters below live in the memory of a single Node
// process. This is NOT reliable distributed protection. It does not coordinate
// across multiple serverless instances, regions, or cold starts, so an
// attacker spreading requests across instances can exceed the intended limit.
// It meaningfully protects only a single long-lived process (a container, VM,
// or dev server). For dependable production limits, use an external store
// (e.g. Redis/Upstash) or the hosting platform's edge/WAF rate limiting.
//
// This module is intentionally dependency-free and side-effect-free so it can
// be unit-tested in isolation.

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the client may retry; 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
}

// Upper bound on tracked keys, to keep memory use bounded under a flood of
// distinct client keys. When exceeded, expired windows are pruned first.
const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const limit = Math.max(1, Math.floor(config.limit));
  const windowMs = Math.max(1, Math.floor(config.windowMs));
  const hits = new Map<string, number[]>();

  function pruneExpired(now: number): void {
    const cutoff = now - windowMs;
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((timestamp) => timestamp > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      if (hits.size >= MAX_TRACKED_KEYS) pruneExpired(now);

      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter(
        (timestamp) => timestamp > cutoff
      );

      if (recent.length >= limit) {
        const oldest = recent[0];
        const retryAfterMs = oldest + windowMs - now;
        hits.set(key, recent);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      recent.push(now);
      hits.set(key, recent);
      return {
        allowed: true,
        remaining: limit - recent.length,
        retryAfterSeconds: 0,
      };
    },
  };
}
