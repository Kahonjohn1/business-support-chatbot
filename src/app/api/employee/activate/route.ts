import { NextResponse, type NextRequest } from "next/server";
import {
  acceptMarqueInvitation,
  MARQUE_TECHNOLOGIES_COMPANY_ID,
} from "@/lib/employee/companyInvitations";
import {
  EMPLOYEE_INVITE_METADATA_KEY,
  isEmployeeInviteUser,
  logInvitationError,
} from "@/lib/employee/invitationOnboarding";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface ActivationPayload {
  password?: unknown;
}

function isPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let payload: ActivationPayload;
  try {
    payload = (await request.json()) as ActivationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isPassword(payload.password)) {
    return NextResponse.json(
      { error: "Choose a password with at least 8 characters." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json(
      { error: "A verified employee invitation session is required." },
      { status: 401 }
    );
  }
  if (!isEmployeeInviteUser(data.user)) {
    return NextResponse.json(
      { error: "A pending employee invitation is required." },
      { status: 403 }
    );
  }

  const { data: pendingMembership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", MARQUE_TECHNOLOGIES_COMPANY_ID)
    .eq("user_id", data.user.id)
    .eq("status", "invited")
    .maybeSingle();

  if (membershipError) {
    logInvitationError("activation_membership_check", membershipError);
    return NextResponse.json(
      { error: "The invitation could not be verified. Please try again." },
      { status: 503 }
    );
  }
  if (!pendingMembership) {
    return NextResponse.json(
      { error: "No pending Marque Technologies invitation was found for this account." },
      { status: 409 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (createError) {
    logInvitationError("activation_admin_client", createError);
    return NextResponse.json(
      { error: "Employee activation is not configured for this deployment." },
      { status: 503 }
    );
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(data.user.id, {
    password: payload.password,
  });

  if (passwordError) {
    logInvitationError("activation_password", passwordError);
    return NextResponse.json(
      { error: "The password could not be set. It may not meet the project password policy." },
      { status: 400 }
    );
  }

  try {
    const accepted = await acceptMarqueInvitation(supabase);
    if (!accepted) {
      return NextResponse.json(
        { error: "Your password was set, but the invitation was no longer pending. Sign in normally or ask for a new invitation." },
        { status: 409 }
      );
    }
  } catch (acceptError) {
    logInvitationError("activation_accept", acceptError);
    return NextResponse.json(
      { error: "Your password was set, but the Marque Technologies invitation could not be accepted. You can retry safely." },
      { status: 503 }
    );
  }

  const { error: flagError } = await admin.auth.admin.updateUserById(data.user.id, {
    user_metadata: {
      ...data.user.user_metadata,
      [EMPLOYEE_INVITE_METADATA_KEY]: false,
    },
  });

  if (flagError) {
    logInvitationError("activation_flag", flagError);
  }

  return NextResponse.json({ ok: true, message: "Account activated." });
}
