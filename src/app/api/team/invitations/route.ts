import { apiError, apiErrorFromException } from "@/lib/http/api";
import type { AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { createTeamWorkspaceInvitation } from "@/lib/workspace/workspaceTeamData";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { auth } = await getActiveProjectManagementAuth();
    return await handleCreateTeamInvitation(request, auth);
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function handleCreateTeamInvitation(
  request: Request,
  auth: AuthorizationContext
): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    if (!isRecord(body)) return apiError(400, "Invalid request payload.");
    const invitation = await createTeamWorkspaceInvitation(
      auth,
      body.email,
      body.role
    );
    return Response.json({ invitation });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") {
      return apiErrorFromException(error);
    }
    if (error instanceof Error && /must be|valid|email/i.test(error.message)) {
      return apiError(400, error.message);
    }
    return apiErrorFromException(error);
  }
}
