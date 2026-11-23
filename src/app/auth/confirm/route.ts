import type { EmailOtpType } from "@supabase/supabase-js";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

function safeNextPath(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const otpType = request.nextUrl.searchParams.get("type");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/");
  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.auth, {
    token: tokenHash,
  });
  if (limited) return limited;
  const supabase = await createSupabaseServerClient();

  if (!tokenHash || !otpType) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType as EmailOtpType,
  });

  if (error) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const destination = otpType === "recovery" ? "/reset-password" : next;
  return NextResponse.redirect(new URL(destination, request.url));
}
