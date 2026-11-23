import { automationApiError } from "@/lib/automation/api";
import { listAutomationExecutions } from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.automation, {
    userId: auth.userId,
    workspaceId: auth.workspaceId ?? null,
  });
  if (limited) return limited;
  try {
    const { id } = await context.params;
    const executions = await listAutomationExecutions(auth, id);
    return Response.json({ executions });
  } catch (error) {
    return automationApiError(error);
  }
}
