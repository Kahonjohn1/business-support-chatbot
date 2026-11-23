import { apiError, apiErrorFromException } from "@/lib/http/api";
import { checkPermission, type AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { parseUpdateTaskInput } from "@/lib/workspace/projectManagementInput";
import { updateWorkspaceTask } from "@/lib/workspace/workspaceProjectData";
import { UPDATE_PROJECT_TASK_TOOL_NAME } from "@/tools/tasksTool";
import { dispatchTaskMutation } from "@/lib/automation/dispatch";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  let auth: AuthorizationContext;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return apiErrorFromException(error);
  }
  const { id } = await context.params;
  return handleUpdateTask(request, auth, id);
}

export async function handleUpdateTask(
  request: Request,
  auth: AuthorizationContext,
  taskId: string
): Promise<Response> {
  try {
    const permission = checkPermission(UPDATE_PROJECT_TASK_TOOL_NAME, auth);
    if (!permission.permitted) {
      return apiError(403, permission.reason ?? "Task updates are not permitted.");
    }
    if (!taskId.trim()) return apiError(400, "A valid task is required.");

    const body = await request.json().catch(() => null);
    const input = parseUpdateTaskInput(body);
    const task = await updateWorkspaceTask(auth, taskId.trim(), input);
    if (!task) return apiError(404, "Task not found.");
    await dispatchTaskMutation(auth, "task.updated", task);
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
