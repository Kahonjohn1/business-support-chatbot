import { apiError, apiErrorFromException } from "@/lib/http/api";
import { checkPermission, type AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { parseCreateTaskInput } from "@/lib/workspace/projectManagementInput";
import { createWorkspaceTask } from "@/lib/workspace/workspaceProjectData";
import { CREATE_PROJECT_TASK_TOOL_NAME } from "@/tools/tasksTool";
import { dispatchTaskMutation } from "@/lib/automation/dispatch";

export async function POST(request: Request): Promise<Response> {
  let auth: AuthorizationContext;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return apiErrorFromException(error);
  }
  return handleCreateTask(request, auth);
}

export async function handleCreateTask(
  request: Request,
  auth: AuthorizationContext
): Promise<Response> {
  try {
    const permission = checkPermission(CREATE_PROJECT_TASK_TOOL_NAME, auth);
    if (!permission.permitted) {
      return apiError(403, permission.reason ?? "Task creation is not permitted.");
    }

    const body = await request.json().catch(() => null);
    const input = parseCreateTaskInput(body);
    const task = await createWorkspaceTask(auth, input);
    await dispatchTaskMutation(auth, "task.created", task);
    return Response.json({ task });
  } catch (error) {
    if (
      error instanceof Error &&
      !error.name.includes("WorkspaceAccessError") &&
      !error.name.includes("PersonalDataError") &&
      !error.name.includes("WorkspaceProjectDataError")
    ) {
      return apiError(400, error.message);
    }
    return apiErrorFromException(error);
  }
}
