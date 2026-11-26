import { NextResponse, type NextRequest } from "next/server";
import { inviteEmployeeToMarque } from "@/lib/employee/companyInvitations";
import { hasPermission, isEmployeeRole } from "@/lib/employee/roles";
import { getEmployeeSession } from "@/lib/employee/session";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
  if (!session) {
    return NextResponse.json({ error: "Sign in to invite employees." }, { status: 401 });
  }
  if (!hasPermission(session.user.role, "employees:invite")) {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
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
    const result = await inviteEmployeeToMarque({
      admin: createAdminClient(),
      sessionClient: await createClient(),
      administratorId: session.user.id,
      email: payload.email,
      fullName: payload.fullName,
      role: payload.role,
      redirectTo: new URL("/auth/confirm", request.nextUrl.origin).toString(),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch {
    return NextResponse.json({ error: "Invitation service is unavailable." }, { status: 503 });
  }
}
