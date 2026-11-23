import { automationApiError } from "@/lib/automation/api";
import { runAutomationNow } from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const { id } = await context.params;
    const execution = await runAutomationNow(auth, id);
    return Response.json({ execution });
  } catch (error) {
    return automationApiError(error);
  }
}
