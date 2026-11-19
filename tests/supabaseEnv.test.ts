import assert from "node:assert/strict";
import test from "node:test";
import {
  getSupabaseEnv,
  isPublicSupabaseKey,
} from "../src/lib/supabase/env.ts";

const ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

type EnvName = (typeof ENV_NAMES)[number];

function createJwt(role: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role, aud: "authenticated" })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

function withEnv(values: Partial<Record<EnvName, string | undefined>>, run: () => void) {
  const original = new Map<EnvName, string | undefined>();
  for (const name of ENV_NAMES) original.set(name, process.env[name]);

  try {
    for (const name of ENV_NAMES) {
      const value = values[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    run();
  } finally {
    for (const name of ENV_NAMES) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("isPublicSupabaseKey accepts publishable tokens and legacy anon JWTs", () => {
  assert.equal(isPublicSupabaseKey("sb_publishable_examplekey"), true);
  assert.equal(isPublicSupabaseKey(createJwt("anon")), true);
});

test("isPublicSupabaseKey rejects secret tokens and service-role JWTs", () => {
  assert.equal(isPublicSupabaseKey("sb_secret_examplekey"), false);
  assert.equal(isPublicSupabaseKey(createJwt("service_role")), false);
  assert.equal(isPublicSupabaseKey("opaque-non-jwt-key"), false);
});

test("getSupabaseEnv prefers the publishable key over a secret anon variable", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_examplekey",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_examplekey",
    },
    () => {
      assert.equal(getSupabaseEnv().anonKey, "sb_publishable_examplekey");
    }
  );
});

test("getSupabaseEnv rejects a secret key in a public variable", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_examplekey",
    },
    () => {
      assert.throws(() => getSupabaseEnv(), /secret or unsupported Supabase key/);
    }
  );
});

test("getSupabaseEnv requires a public Supabase key", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    },
    () => {
      assert.throws(() => getSupabaseEnv(), /PUBLISHABLE_KEY is missing/);
    }
  );
});

test("signup sends the selected public key and never the secret key", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const publishableKey = "sb_publishable_examplekey";
  const secretKey = "sb_secret_examplekey";
  const captured: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  const originalEnv = new Map<EnvName, string | undefined>();
  for (const name of ENV_NAMES) originalEnv.set(name, process.env[name]);

  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = secretKey;
    globalThis.fetch = async (...args) => {
      captured.push((args[1] as RequestInit | undefined) ?? {});
      return new Response(
        JSON.stringify({ id: "diagnostic", email: "diagnostic@example.invalid" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const { url, anonKey } = getSupabaseEnv();
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await supabase.auth.signUp({
      email: "diagnostic@example.invalid",
      password: "diagnostic-only",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2F",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of ENV_NAMES) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.equal(captured.length, 1);
  const headers = new Headers(captured[0].headers);
  assert.equal(headers.get("apikey"), publishableKey);
  assert.equal(headers.get("authorization"), `Bearer ${publishableKey}`);
  assert.notEqual(headers.get("apikey"), secretKey);
});
