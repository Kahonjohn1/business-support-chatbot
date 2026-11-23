import {
  createSupabaseRateLimitStore,
  hashRateLimitKey,
  type RateLimitStore,
} from "@/lib/rateLimit";

export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const RATE_LIMIT_POLICIES = {
  chat: {
    name: "chat",
    limit: envInt("RATE_LIMIT_MAX", 30),
    windowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000),
  },
  auth: { name: "auth", limit: 12, windowMs: 60_000 },
  integrationCallback: {
    name: "integration-callback",
    limit: 10,
    windowMs: 60_000,
  },
  integration: { name: "integration", limit: 30, windowMs: 60_000 },
  approval: { name: "approval", limit: 30, windowMs: 60_000 },
  automation: { name: "automation", limit: 60, windowMs: 60_000 },
  automationRunDue: {
    name: "automation-run-due",
    limit: 120,
    windowMs: 60_000,
  },
} as const satisfies Record<string, RateLimitPolicy>;

let activeStore: RateLimitStore = createSupabaseRateLimitStore();

export function setRateLimitStore(store: RateLimitStore): void {
  activeStore = store;
}

export function resetRateLimitStore(): void {
  activeStore = createSupabaseRateLimitStore();
}

export interface RateLimitIdentity {
  readonly userId?: string | null;
  readonly workspaceId?: string | null;
  readonly token?: string | null;
}

function clientIpKey(request: Request): string {
  if (process.env.TRUST_PROXY !== "1") return "direct";
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 64) || "unknown";
  return request.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
}

export async function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  identity: RateLimitIdentity = {}
): Promise<Response | null> {
  const key = hashRateLimitKey([
    policy.name,
    clientIpKey(request),
    identity.userId ?? "",
    identity.workspaceId ?? "",
    identity.token ? hashRateLimitKey([identity.token]) : "",
  ]);

  let result;
  try {
    result = await activeStore.consume(key, policy.limit, policy.windowMs);
  } catch {
    return Response.json(
      { error: "Service temporarily unavailable. Please try again." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const headers = {
    "x-ratelimit-limit": String(policy.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "cache-control": "no-store",
  };
  if (!result.allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          ...headers,
          "retry-after": String(Math.max(1, result.retryAfterSeconds)),
        },
      }
    );
  }
  return null;
}
