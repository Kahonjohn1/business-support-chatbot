import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { INTEGRATION_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import { integrationApiError, integrationPermissionError } from "@/lib/integrations/api";
import { listIntegrationViews } from "@/lib/integrations/data";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const { auth } = await getActiveProjectManagementAuth();
    const permissionError = integrationPermissionError(
      INTEGRATION_PERMISSION_TOOL_NAMES.listConnections,
      auth
    );
    if (permissionError) return permissionError;

    const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.integration, {
      userId: auth.userId,
      workspaceId: auth.workspaceId ?? null,
    });
    if (limited) return limited;

    const providers = await listIntegrationViews(auth);
    return Response.json({ ok: true, providers }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return integrationApiError(error);
  }
}
