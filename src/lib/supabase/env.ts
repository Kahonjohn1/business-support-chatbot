export interface SupabaseEnv {
  readonly url: string;
  readonly anonKey: string;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function getJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (typeof payload !== "object" || payload === null) return null;
    const role = (payload as Record<string, unknown>).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function isPublicSupabaseKey(key: string): boolean {
  const value = key.trim();
  if (!value) return false;
  if (value.startsWith("sb_publishable_")) return true;
  if (value.startsWith("sb_secret_")) return false;
  return getJwtRole(value) === "anon";
}

export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing. Set NEXT_PUBLIC_SUPABASE_URL in .env.local and restart the development server."
    );
  }

  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const anonKey = publishableKey || legacyAnonKey;

  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. Set it to the project's sb_publishable_... key (or a legacy anon key in NEXT_PUBLIC_SUPABASE_ANON_KEY) and restart the development server."
    );
  }

  if (!isPublicSupabaseKey(anonKey)) {
    const variable = publishableKey
      ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
      : "NEXT_PUBLIC_SUPABASE_ANON_KEY";
    throw new Error(
      `${variable} contains a secret or unsupported Supabase key. Use an sb_publishable_... key or a legacy anon key; keep secret keys out of NEXT_PUBLIC variables.`
    );
  }

  return { url, anonKey };
}
