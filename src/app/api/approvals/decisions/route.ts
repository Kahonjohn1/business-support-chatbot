import { NextResponse, type NextRequest } from "next/server";
import { getEmployeeCompanyRole } from "@/lib/employee/reviewData";
import { hasPermission } from "@/lib/employee/roles";
import { getEmployeeSession } from "@/lib/employee/session";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

type Decision = "approved" | "rejected";

interface DecisionPayload {
  approvalId?: unknown;
  decision?: unknown;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function isDecision(value: unknown): value is Decision {
  return value === "approved" || value === "rejected";
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const session = await getEmployeeSession();
  if (!session || !hasPermission(session.user.role, "approvals:review")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const companyRole = await getEmployeeCompanyRole(session.user.id);
  if (companyRole !== "owner" && companyRole !== "admin") {
    return NextResponse.json({ error: "Company admin role required" }, { status: 403 });
  }

  let payload: DecisionPayload;
  try {
    payload = (await request.json()) as DecisionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isUuid(payload.approvalId) || !isDecision(payload.decision)) {
    return NextResponse.json({ error: "Invalid decision details" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_approval", {
    p_approval_id: payload.approvalId,
    p_decision: payload.decision,
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("expired")) {
      return NextResponse.json({ error: "Approval request has expired" }, { status: 409 });
    }
    if (message.includes("role") || message.includes("permission")) {
      return NextResponse.json({ error: "Company admin role required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Approval decision could not be recorded" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    message: `Approval ${payload.decision}.`,
  });
}
