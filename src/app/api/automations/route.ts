import { automationApiError } from "@/lib/automation/api";
import {
  createAutomationWorkflow,
  listAutomationExecutions,
  listAutomationWorkflows,
} from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

export async function GET(): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const [workflows, executions] = await Promise.all([
      listAutomationWorkflows(auth),
      listAutomationExecutions(auth),
    ]);
    return Response.json({ workflows, executions });
  } catch (error) {
    return automationApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const body = await request.json().catch(() => null);
    const workflow = await createAutomationWorkflow(auth, body);
    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    return automationApiError(error);
  }
}
