import { automationApiError } from "@/lib/automation/api";
import { listAutomationExecutions } from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const { id } = await context.params;
    const executions = await listAutomationExecutions(auth, id);
    return Response.json({ executions });
  } catch (error) {
    return automationApiError(error);
  }
}
