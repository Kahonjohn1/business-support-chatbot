import { apiError, apiErrorFromException } from "@/lib/http/api";
import { checkPermission, type AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { parseCreateProjectInput } from "@/lib/workspace/projectManagementInput";
import { createWorkspaceProject } from "@/lib/workspace/workspaceProjectData";
import { CREATE_PROJECT_TOOL_NAME } from "@/tools/projectStatusTool";
import { dispatchProjectMutation } from "@/lib/automation/dispatch";

export async function POST(request: Request): Promise<Response> {
  let auth: AuthorizationContext;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return apiErrorFromException(error);
  }
  return handleCreateProject(request, auth);
}

export async function handleCreateProject(
  request: Request,
  auth: AuthorizationContext
): Promise<Response> {
  try {
    const permission = checkPermission(CREATE_PROJECT_TOOL_NAME, auth);
    if (!permission.permitted) {
      return apiError(403, permission.reason ?? "Project creation is not permitted.");
    }

    const body = await request.json().catch(() => null);
    const input = parseCreateProjectInput(body);
    const project = await createWorkspaceProject(auth, input);
    await dispatchProjectMutation(auth, "project.created", project);
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
