import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { acceptMarqueInvitation } from "@/lib/employee/companyInvitations";
import { safeNextPath } from "@/lib/employee/redirects";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = ["invite", "email", "recovery", "signup", "magiclink"] as const;

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (allowedTypes as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=confirm_failed", origin));

    try {
      await acceptMarqueInvitation(supabase);
    } catch {
      return NextResponse.redirect(new URL("/login?error=company_invitation_failed", origin));
    }

    return NextResponse.redirect(new URL(next, origin));
  }

  if (!tokenHash || !isOtpType(type)) {
    return NextResponse.redirect(new URL("/login?error=invalid_confirm_link", origin));
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=confirm_failed", origin));
  }

  try {
    await acceptMarqueInvitation(supabase);
  } catch {
    return NextResponse.redirect(new URL("/login?error=company_invitation_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
