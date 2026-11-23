import { integrationApiError, integrationPermissionError } from "@/lib/integrations/api";
import { disconnectIntegration } from "@/lib/integrations/data";
import { isIntegrationProviderId } from "@/lib/integrations/providers";
import { INTEGRATION_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

interface RouteContext {
  readonly params: Promise<{ provider: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { provider: providerParam } = await context.params;
    if (!isIntegrationProviderId(providerParam)) {
      return Response.json({ error: "Unsupported integration provider." }, { status: 400 });
    }

    const { auth } = await getActiveProjectManagementAuth();
    const permissionError = integrationPermissionError(
      INTEGRATION_PERMISSION_TOOL_NAMES.disconnect,
      auth
    );
    if (permissionError) return permissionError;

    await disconnectIntegration(auth, providerParam);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return integrationApiError(error);
  }
}
