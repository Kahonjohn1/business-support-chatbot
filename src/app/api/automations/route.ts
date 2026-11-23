import { automationApiError } from "@/lib/automation/api";
import {
  createAutomationWorkflow,
  listAutomationExecutions,
  listAutomationWorkflows,
} from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";

export async function GET(request: Request): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  const readLimited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.automation, {
    userId: auth.userId,
    workspaceId: auth.workspaceId ?? null,
  });
  if (readLimited) return readLimited;
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
  const writeLimited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.automation, {
    userId: auth.userId,
    workspaceId: auth.workspaceId ?? null,
  });
  if (writeLimited) return writeLimited;
  try {
    const body = await request.json().catch(() => null);
    const workflow = await createAutomationWorkflow(auth, body);
    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    return automationApiError(error);
  }
}
