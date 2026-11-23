import { cookies } from "next/headers";

import { integrationPermissionError } from "@/lib/integrations/api";
import { IntegrationError } from "@/lib/integrations/errors";
import { resolveTrustedRedirectOrigin } from "@/lib/integrations/config";
import {
  exchangeGoogleCode,
  fetchGoogleAccountLabel,
  hasRequiredIntegrationScopes,
  integrationOAuthCookieName,
  readIntegrationOAuthState,
  readIntegrationOAuthStateEnvelope,
} from "@/lib/integrations/oauth";
import { resolveIntegrationContext, saveIntegrationTokens } from "@/lib/integrations/data";
import { INTEGRATION_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import {
  enforceRateLimit,
  RATE_LIMIT_POLICIES,
} from "@/lib/requestRateLimit";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

function safeErrorCode(error: unknown): string {
  if (error instanceof IntegrationError) return error.code;
  return "CALLBACK_FAILED";
}

export async function GET(request: Request): Promise<Response> {
  let redirectOrigin: string;
  try {
    redirectOrigin = resolveTrustedRedirectOrigin(request);
  } catch (error) {
    return Response.json(
      { error: "This integration is not configured." },
      { status: safeErrorCode(error) === "PROVIDER_NOT_CONFIGURED" ? 503 : 400 }
    );
  }

  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();

  const redirectWithError = (code: string, stateToDelete?: string): Response => {
    if (stateToDelete) cookieStore.delete(integrationOAuthCookieName(stateToDelete));
    const target = new URL("/integrations", redirectOrigin);
    target.searchParams.set("integration_error", code);
    return Response.redirect(target.toString(), 303);
  };

  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    return redirectWithError(providerError === "access_denied" ? "ACCESS_DENIED" : "OAUTH_FAILED");
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) {
    return redirectWithError("INVALID_REQUEST");
  }

  let cookieName: string;
  try {
    cookieName = integrationOAuthCookieName(state);
  } catch {
    return redirectWithError("INVALID_REQUEST");
  }

  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.integrationCallback, {
    token: state,
  });
  if (limited) return limited;

  try {
    const { auth } = await getActiveProjectManagementAuth();
    const cookieValue = cookieStore.get(cookieName)?.value;
    const envelope = readIntegrationOAuthStateEnvelope(cookieValue, state);
    const provider = envelope.payload.provider;
    const oauthState = readIntegrationOAuthState(cookieValue, state, provider, auth.userId);

    const permissionError = integrationPermissionError(
      INTEGRATION_PERMISSION_TOOL_NAMES.connect,
      auth
    );
    if (permissionError) return redirectWithError("PERMISSION_DENIED", state);

    const integrationContext = await resolveIntegrationContext(
      auth,
      INTEGRATION_PERMISSION_TOOL_NAMES.connect
    );

    if (
      integrationContext.scope !== oauthState.payload.scope ||
      (integrationContext.workspaceId ?? null) !== (oauthState.payload.workspaceId ?? null)
    ) {
      return redirectWithError("WORKSPACE_MISMATCH", state);
    }

    const tokens = await exchangeGoogleCode(code, oauthState.codeVerifier);
    if (!hasRequiredIntegrationScopes(provider, tokens.scopes)) {
      return redirectWithError("MISSING_SCOPES", state);
    }
    const accountLabel = await fetchGoogleAccountLabel(tokens.accessToken);
    await saveIntegrationTokens(auth, provider, {
      ...tokens,
      accountLabel: accountLabel ?? `Connected ${provider} account`,
    });

    cookieStore.delete(cookieName);
    const target = new URL("/integrations", redirectOrigin);
    target.searchParams.set("integration_connected", provider);
    return Response.redirect(target.toString(), 303);
  } catch (error) {
    return redirectWithError(safeErrorCode(error), state);
  }
}
