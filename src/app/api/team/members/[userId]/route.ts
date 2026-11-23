import { apiError, apiErrorFromException } from "@/lib/http/api";
import type { AuthorizationContext } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import {
  removeTeamWorkspaceMember,
  updateTeamWorkspaceMemberRole,
} from "@/lib/workspace/workspaceTeamData";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapError(error: unknown): Response {
  if (error instanceof Error && error.name === "WorkspaceAccessError") {
    return apiErrorFromException(error);
  }
  if (error instanceof Error && /must be|required|not found|manager|owner/i.test(error.message)) {
    return apiError(400, error.message);
  }
  return apiErrorFromException(error);
}

export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { auth } = await getActiveProjectManagementAuth();
    const { userId } = await context.params;
    return await handleUpdateTeamMember(request, auth, userId);
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { auth } = await getActiveProjectManagementAuth();
    const { userId } = await context.params;
    return await handleRemoveTeamMember(auth, userId);
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function handleUpdateTeamMember(
  request: Request,
  auth: AuthorizationContext,
  memberUserId: string
): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    if (!isRecord(body)) return apiError(400, "Invalid request payload.");
    const member = await updateTeamWorkspaceMemberRole(
      auth,
      memberUserId,
      body.role
    );
    return Response.json({ member });
  } catch (error) {
    return mapError(error);
  }
}

export async function handleRemoveTeamMember(
  auth: AuthorizationContext,
  memberUserId: string
): Promise<Response> {
  try {
    await removeTeamWorkspaceMember(auth, memberUserId);
    return Response.json({ ok: true });
  } catch (error) {
    return mapError(error);
  }
}
