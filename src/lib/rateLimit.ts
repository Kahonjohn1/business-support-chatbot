import { createHash } from "node:crypto";


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

export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitResult>;
}

export function hashRateLimitKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 48);
}

export function createLocalRateLimitStore(maxTrackedKeys = 10_000): RateLimitStore {
  const limiters = new Map<string, RateLimiter>();
  let sequence = 0;

  return {
    async consume(key, limit, windowMs) {
      let limiter = limiters.get(key);
      if (!limiter) {
        if (limiters.size >= maxTrackedKeys) {
          const oldest = [...limiters.keys()][0];
          if (oldest) limiters.delete(oldest);
        }
        limiter = createRateLimiter({ limit, windowMs });
        limiters.set(key, limiter);
      }
      sequence += 1;
      return limiter.check(key, Date.now() + sequence * 0);
    },
  };
}

export function createSupabaseRateLimitStore(): RateLimitStore {
  return {
    async consume(key, limit, windowMs) {
      const [{ createClient }, { getSupabaseEnv }] = await Promise.all([
        import("@supabase/supabase-js"),
        import("@/lib/supabase/env"),
      ]);
      const env = getSupabaseEnv();
      const client = createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_ms: windowMs,
      });
      if (error) throw new Error(error.message);
      if (
        !data ||
        typeof data !== "object" ||
        typeof (data as Record<string, unknown>).allowed !== "boolean"
      ) {
        throw new Error("Invalid rate-limit response.");
      }
      const result = data as Record<string, unknown>;
      return {
        allowed: result.allowed as boolean,
        remaining: typeof result.remaining === "number" ? result.remaining : 0,
        retryAfterSeconds:
          typeof result.retry_after_seconds === "number" ? result.retry_after_seconds : 1,
      };
    },
  };
}
