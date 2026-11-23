import { apiError, apiErrorFromException } from "@/lib/http/api";
import {
  ACTIVE_WORKSPACE_COOKIE,
  findWorkspaceOption,
  listWorkspaceOptions,
} from "@/lib/workspace/workspaceSelection";
import type { WorkspaceContext } from "@/lib/workspace/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<Response> {
  let context: WorkspaceContext;
  try {
    const { requireAuthenticatedApi } = await import("@/lib/workspace/server");
    context = await requireAuthenticatedApi();
  } catch (error) {
    return apiErrorFromException(error);
  }
  return handleActiveWorkspacePost(request, context);
}

export async function handleActiveWorkspacePost(
  request: Request,
  context: WorkspaceContext
): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "Invalid JSON request body.");
    }
    if (!isRecord(body)) {
      return apiError(400, "Invalid request payload.");
    }

    const available = await listWorkspaceOptions(context.user);
    const option = findWorkspaceOption(available.options, body.workspaceId);
    if (!option) {
      return apiError(403, "You cannot switch to that workspace.");
    }

    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    const response = Response.json({ ok: true, workspace: option });
    response.headers.set(
      "Set-Cookie",
      `${ACTIVE_WORKSPACE_COOKIE}=${encodeURIComponent(option.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${secure}`
    );
    return response;
  } catch (error) {
    return apiErrorFromException(error);
  }
}
