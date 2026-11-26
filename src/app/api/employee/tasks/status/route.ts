import { NextResponse, type NextRequest } from "next/server";
import { parseTaskStatusPayload } from "@/lib/employee/projectTaskInput";
import { updateAssignedTaskStatus } from "@/lib/employee/projectTaskManagement";
import { getEmployeeSession } from "@/lib/employee/session";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const session = await getEmployeeSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to update tasks." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseTaskStatusPayload(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof updateAssignedTaskStatus>>;
  try {
    result = await updateAssignedTaskStatus(await createClient(), parsed.value);
  } catch {
    return NextResponse.json({ error: "Task status service is unavailable." }, { status: 503 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, message: "Task status updated." });
}
