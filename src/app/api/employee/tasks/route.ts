import { NextResponse, type NextRequest } from "next/server";
import { parseCreateTaskPayload } from "@/lib/employee/projectTaskInput";
import { createMarqueTask } from "@/lib/employee/projectTaskManagement";
import { hasRoleAtLeast } from "@/lib/employee/roles";
import { getEmployeeSession } from "@/lib/employee/session";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const session = await getEmployeeSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to create tasks." }, { status: 401 });
  }
  if (!hasRoleAtLeast(session.user.role, "manager")) {
    return NextResponse.json({ error: "Manager or administrator access is required." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseCreateTaskPayload(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof createMarqueTask>>;
  try {
    result = await createMarqueTask(
      {
        sessionClient: await createClient(),
        actorId: session.user.id,
        actorRole: session.user.role,
      },
      parsed.value
    );
  } catch {
    return NextResponse.json({ error: "Task service is unavailable." }, { status: 503 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, task: result.data });
}
