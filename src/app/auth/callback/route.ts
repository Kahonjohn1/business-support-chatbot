import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

interface CallbackError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function redactLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !/^[A-Za-z0-9_.:-]{1,120}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeErrorMessage(value: unknown): string | null {
  const source = typeof value === "string" ? value : null;
  if (!source) return null;

  const sanitized = source
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[key]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[id]"
    )
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]")
    .replace(
      /\b(?:token|code|apikey|api_key|authorization|cookie|session|password)[ \t]*[:=][ \t]*[^\s,;]+/gi,
      "[redacted]"
    )
    .replace(/\s+/g, " ")
    .trim();

  return sanitized ? sanitized.slice(0, 200) : null;
}

function logDiagnostic(phase: string, fields: Record<string, string | null> = {}): void {
  try {
    console.log(
      JSON.stringify({
        level: "warn",
        phase: `auth.callback.${phase}`,
        ...fields,
      })
    );
  } catch {
    return;
  }
}

function getCallbackErrorFields(error: unknown): Record<string, string | null> {
  const candidate = (
    typeof error === "object" && error !== null ? error : {}
  ) as CallbackError;

  return {
    errorName: redactLabel(candidate.name) ?? "[redacted]",
    errorCode: redactLabel(candidate.code),
    errorMessage: sanitizeErrorMessage(
      typeof error === "string" ? error : candidate.message
    ),
  };
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.auth, { token: code });
  if (limited) return limited;
  const supabase = await createSupabaseServerClient();

  if (!code) {
    logDiagnostic("missing_code");
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logDiagnostic("exchange_failed", getCallbackErrorFields(error));
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
