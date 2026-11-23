import "server-only";

import { apiError, apiErrorFromException } from "@/lib/http/api";
import { IntegrationError } from "@/lib/integrations/errors";
import { checkPermission, type AuthorizationContext } from "@/lib/permissions";

export function integrationApiError(error: unknown): Response {
  if (error instanceof IntegrationError) {
    return apiError(error.status, error.message);
  }
  return apiErrorFromException(error);
}

export function integrationPermissionError(
  toolName: string,
  auth: AuthorizationContext
): Response | null {
  const result = checkPermission(toolName, auth);
  if (result.permitted) return null;
  return apiError(403, result.reason || "Integration access is not permitted.");
}
