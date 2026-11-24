import { NextResponse, type NextRequest } from "next/server";
import { hasPermission, isEmployeeRole } from "@/lib/employee/roles";
import { getEmployeeSession } from "@/lib/employee/session";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createAdminClient } from "@/lib/supabase/admin";

interface InvitationPayload {
  email?: unknown;
  fullName?: unknown;
  role?: unknown;
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isFullName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const session = await getEmployeeSession();
  if (!session || !hasPermission(session.user.role, "employees:invite")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: InvitationPayload;
  try {
    payload = (await request.json()) as InvitationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isEmail(payload.email) || !isFullName(payload.fullName) || !isEmployeeRole(payload.role)) {
    return NextResponse.json({ error: "Invalid invitation details" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(payload.email.trim().toLowerCase(), {
      data: {
        employee_invite: true,
        full_name: payload.fullName.trim(),
        role: payload.role,
      },
      redirectTo: new URL("/auth/confirm", request.nextUrl.origin).toString(),
    });

    if (error) {
      const status = error.message.toLowerCase().includes("already") ? 409 : 502;
      return NextResponse.json({ error: "Invitation could not be sent" }, { status });
    }

    return NextResponse.json({ ok: true, message: "Invitation sent." });
  } catch {
    return NextResponse.json({ error: "Supabase admin is not configured" }, { status: 503 });
  }
}
