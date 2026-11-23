import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { INTEGRATION_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import { integrationApiError, integrationPermissionError } from "@/lib/integrations/api";
import { listIntegrationViews } from "@/lib/integrations/data";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export async function GET(): Promise<Response> {
  try {
    const { auth } = await getActiveProjectManagementAuth();
    const permissionError = integrationPermissionError(
      INTEGRATION_PERMISSION_TOOL_NAMES.listConnections,
      auth
    );
    if (permissionError) return permissionError;

    const providers = await listIntegrationViews(auth);
    return Response.json({ ok: true, providers }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return integrationApiError(error);
  }
}
