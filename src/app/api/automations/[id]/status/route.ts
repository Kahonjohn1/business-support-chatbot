import { automationApiError } from "@/lib/automation/api";
import { setAutomationWorkflowStatus } from "@/lib/automation/engine";
import type { AutomationWorkflowStatus } from "@/lib/automation/types";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const status = body && typeof body === "object" && "status" in body ? body.status : null;
    const workflow = await setAutomationWorkflowStatus(
      auth,
      id,
      status as AutomationWorkflowStatus
    );
    return Response.json({ workflow });
  } catch (error) {
    return automationApiError(error);
  }
}
