import { cookies } from "next/headers";

import { getIntegrationProviderConfigStatus } from "@/lib/integrations/config";
import {
  INTEGRATION_OAUTH_COOKIE,
  INTEGRATION_OAUTH_MAX_AGE_SECONDS,
  buildGoogleAuthorizationUrl,
  createIntegrationOAuthState,
  createIntegrationPkcePair,
} from "@/lib/integrations/oauth";
import { isIntegrationProviderId } from "@/lib/integrations/providers";
import { integrationApiError, integrationPermissionError } from "@/lib/integrations/api";
import { resolveIntegrationContext } from "@/lib/integrations/data";
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
      INTEGRATION_PERMISSION_TOOL_NAMES.connect,
      auth
    );
    if (permissionError) return permissionError;

    const configStatus = getIntegrationProviderConfigStatus(providerParam);
    if (!configStatus.configured) {
      return Response.json(
        {
          error: "This integration is not configured.",
          missingConfig: configStatus.missingConfig,
        },
        { status: 503 }
      );
    }

    const integrationContext = await resolveIntegrationContext(
      auth,
      INTEGRATION_PERMISSION_TOOL_NAMES.connect
    );
    const pkce = createIntegrationPkcePair();
    const oauthState = createIntegrationOAuthState({
      provider: providerParam,
      userId: integrationContext.userId,
      scope: integrationContext.scope,
      workspaceId: integrationContext.workspaceId,
      codeVerifier: pkce.verifier,
    });
    const authorizationUrl = buildGoogleAuthorizationUrl(
      providerParam,
      oauthState.state,
      pkce.challenge
    );

    const cookieStore = await cookies();
    cookieStore.set(INTEGRATION_OAUTH_COOKIE, oauthState.cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INTEGRATION_OAUTH_MAX_AGE_SECONDS,
    });

    return Response.json(
      { ok: true, authorizationUrl },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return integrationApiError(error);
  }
}
