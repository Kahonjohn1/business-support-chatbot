import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { acceptMarqueInvitation } from "@/lib/employee/companyInvitations";
import { isEmployeeInviteUser, logInvitationError } from "@/lib/employee/invitationOnboarding";
import { safeNextPath } from "@/lib/employee/redirects";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = ["invite", "email", "recovery", "signup", "magiclink"] as const;

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (allowedTypes as readonly string[]).includes(value);
}

function activationRedirect(origin: string, next: string) {
  const activationUrl = new URL("/auth/activate", origin);
  activationUrl.searchParams.set("next", next);
  return NextResponse.redirect(activationUrl);
}

function fragmentConfirmationRedirect(origin: string, next: string) {
  const confirmationUrl = new URL("/auth/confirm/session", origin);
  confirmationUrl.searchParams.set("next", next);
  return NextResponse.redirect(confirmationUrl);
}

async function acceptAndRedirect(
  supabase: SupabaseClient,
  origin: string,
  next: string
) {
  try {
    await acceptMarqueInvitation(supabase);
  } catch (error) {
    logInvitationError("confirm_accept", error);
    return NextResponse.redirect(new URL("/login?error=company_invitation_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.redirect(new URL("/login?error=invalid_confirm_link", origin));
    }
    if (isEmployeeInviteUser(userData.user)) return activationRedirect(origin, next);

    return acceptAndRedirect(supabase, origin, next);
  }

  if (!tokenHash || !isOtpType(type)) {
    return fragmentConfirmationRedirect(origin, next);
  }

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    logInvitationError("verify_otp", error);
    return NextResponse.redirect(new URL("/login?error=confirm_failed", origin));
  }

  if (!data.user) {
    return fragmentConfirmationRedirect(origin, next);
  }

  if (isEmployeeInviteUser(data.user)) return activationRedirect(origin, next);

  return acceptAndRedirect(supabase, origin, next);
}
