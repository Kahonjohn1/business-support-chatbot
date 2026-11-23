import { apiError, apiErrorFromException } from "@/lib/http/api";
import { checkPermission, type AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { parseUpdateProjectInput } from "@/lib/workspace/projectManagementInput";
import { updateWorkspaceProject } from "@/lib/workspace/workspaceProjectData";
import { UPDATE_PROJECT_TOOL_NAME } from "@/tools/projectStatusTool";
import { dispatchProjectMutation } from "@/lib/automation/dispatch";

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
  return handleUpdateProject(request, auth, id);
}

export async function handleUpdateProject(
  request: Request,
  auth: AuthorizationContext,
  projectId: string
): Promise<Response> {
  try {
    const permission = checkPermission(UPDATE_PROJECT_TOOL_NAME, auth);
    if (!permission.permitted) {
      return apiError(403, permission.reason ?? "Project updates are not permitted.");
    }
    if (!projectId.trim()) return apiError(400, "A valid project is required.");

    const body = await request.json().catch(() => null);
    const input = parseUpdateProjectInput(body);
    const project = await updateWorkspaceProject(auth, projectId.trim(), input);
    if (!project) return apiError(404, "Project not found.");
    await dispatchProjectMutation(auth, "project.updated", project);
    return Response.json({ project });
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
