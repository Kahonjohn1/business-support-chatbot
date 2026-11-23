import "server-only";

import {
  checkPermission,
  INTEGRATION_PERMISSION_TOOL_NAMES,
  type AuthorizationContext,
  type UserRole,
} from "@/lib/permissions";
import { getIntegrationProviderConfigStatus } from "@/lib/integrations/config";
import { encryptIntegrationSecret } from "@/lib/integrations/credentials";
import { IntegrationError } from "@/lib/integrations/errors";
import { getIntegrationProvider, INTEGRATION_PROVIDERS } from "@/lib/integrations/providers";
import {
  getIntegrationRepository,
  type IntegrationConnectionFilter,
} from "@/lib/integrations/repository";
import type {
  IntegrationAuditRecordInput,
  IntegrationConnectionRecord,
  IntegrationConnectionScope,
  IntegrationConnectionStatus,
  IntegrationConnectionView,
  IntegrationProviderId,
  IntegrationProviderView,
} from "@/lib/integrations/types";
import { requireHybridWorkspaceAccess } from "@/lib/workspace/hybridWorkspaceData";

export interface IntegrationContext {
  readonly userId: string;
  readonly scope: IntegrationConnectionScope;
  readonly workspaceId: string | null;
  readonly role: UserRole;
  readonly canManage: boolean;
  readonly auth: AuthorizationContext;
}

export interface IntegrationTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
  readonly scopes: readonly string[];
  readonly accountLabel: string | null;
}

const SENSITIVE_KEY_PATTERN = /key|token|secret|auth|password|bearer|cookie/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireAuthorization(auth: unknown): AuthorizationContext {
  if (!isRecord(auth)) {
    throw new IntegrationError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
  }
  return auth as unknown as AuthorizationContext;
}

function requirePermission(toolName: string, auth: AuthorizationContext): void {
  const result = checkPermission(toolName, auth);
  if (!result.permitted) {
    throw new IntegrationError(403, "PERMISSION_DENIED", "Integration access is not permitted.");
  }
}

export async function resolveIntegrationContext(
  auth: unknown,
  permissionToolName: string
): Promise<IntegrationContext> {
  const authorization = requireAuthorization(auth);
  requirePermission(permissionToolName, authorization);
  const userId = authorization.userId?.trim();
  if (!userId) {
    throw new IntegrationError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
  }

  if (
    authorization.workspaceKind === "personal" &&
    authorization.source === "personal_owner"
  ) {
    return {
      userId,
      scope: "personal",
      workspaceId: null,
      role: authorization.role,
      canManage: true,
      auth: authorization,
    };
  }

  if (
    authorization.workspaceKind === "shared" &&
    authorization.source === "verified_membership" &&
    typeof authorization.workspaceId === "string" &&
    authorization.workspaceId.trim()
  ) {
    const workspaceId = authorization.workspaceId.trim();
    const { workspace } = await requireHybridWorkspaceAccess(
      authorization,
      workspaceId,
      "viewer"
    );
    if (workspace.type !== "business") {
      throw new IntegrationError(
        403,
        "PERMISSION_DENIED",
        "Integrations are available only in business workspaces."
      );
    }
    return {
      userId,
      scope: "workspace",
      workspaceId,
      role: authorization.role,
      canManage: authorization.role === "admin" || authorization.role === "operator",
      auth: authorization,
    };
  }

  throw new IntegrationError(
    403,
    "PERMISSION_DENIED",
    "An active personal or business workspace is required."
  );
}

export function toIntegrationFilter(context: IntegrationContext): IntegrationConnectionFilter {
  return {
    userId: context.userId,
    scope: context.scope,
    workspaceId: context.workspaceId,
  };
}

export function toIntegrationConnectionView(
  record: IntegrationConnectionRecord,
  context: IntegrationContext
): IntegrationConnectionView {
  return {
    id: record.id,
    scope: record.scope,
    provider: record.provider,
    status: record.status,
    accountLabel: record.accountLabel,
    grantedScopes: [...record.grantedScopes],
    tokenExpiresAt: record.tokenExpiresAt,
    lastError: record.lastError,
    canManage: context.canManage || record.ownerUserId === context.userId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function sanitizeIntegrationDetails(
  details?: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  if (!details) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.map((entry) =>
        isRecord(entry) ? sanitizeIntegrationDetails(entry) : String(entry).slice(0, 200)
      );
    } else if (isRecord(value)) {
      result[key] = sanitizeIntegrationDetails(value);
    } else if (typeof value === "string") {
      result[key] = value.slice(0, 200);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function recordIntegrationAudit(
  context: IntegrationContext,
  event: Omit<IntegrationAuditRecordInput, "scope" | "workspaceId">
): Promise<void> {
  try {
    await getIntegrationRepository().appendAudit(context.userId, {
      ...event,
      scope: context.scope,
      workspaceId: context.workspaceId,
      details: sanitizeIntegrationDetails(event.details),
    });
  } catch {}
}

export async function listIntegrationViews(
  auth: unknown
): Promise<readonly IntegrationProviderView[]> {
  const context = await resolveIntegrationContext(
    auth,
    INTEGRATION_PERMISSION_TOOL_NAMES.listConnections
  );
  const connections = await getIntegrationRepository().listConnections(
    toIntegrationFilter(context)
  );
  return INTEGRATION_PROVIDERS.map((provider) => {
    const configStatus = getIntegrationProviderConfigStatus(provider.id);
    const connection = connections.find((item) => item.provider === provider.id);
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      configured: configStatus.configured,
      missingConfig: configStatus.missingConfig,
      requiredScopes: [...provider.requiredScopes],
      capabilities: [...provider.capabilities],
      connection: connection ? toIntegrationConnectionView(connection, context) : null,
    };
  });
}

export async function findIntegrationConnection(
  auth: unknown,
  provider: IntegrationProviderId,
  permissionToolName: string
): Promise<{
  context: IntegrationContext;
  connection: IntegrationConnectionRecord;
}> {
  const context = await resolveIntegrationContext(auth, permissionToolName);
  const connection = await getIntegrationRepository().findConnection(
    toIntegrationFilter(context),
    provider
  );
  if (!connection) {
    throw new IntegrationError(404, "NOT_CONNECTED", "This provider is not connected.");
  }
  return { context, connection };
}

export async function saveIntegrationTokens(
  auth: unknown,
  provider: IntegrationProviderId,
  tokens: IntegrationTokenSet
): Promise<IntegrationConnectionView> {
  const providerDefinition = getIntegrationProvider(provider);
  if (!providerDefinition) {
    throw new IntegrationError(400, "PROVIDER_NOT_FOUND", "Unsupported integration provider.");
  }
  const configStatus = getIntegrationProviderConfigStatus(provider);
  if (!configStatus.configured) {
    throw new IntegrationError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "This integration provider is not configured."
    );
  }
  const context = await resolveIntegrationContext(
    auth,
    INTEGRATION_PERMISSION_TOOL_NAMES.connect
  );
  const record = await getIntegrationRepository().upsertConnection({
    userId: context.userId,
    scope: context.scope,
    workspaceId: context.workspaceId,
    provider,
    status: "connected",
    accountLabel: tokens.accountLabel,
    grantedScopes: tokens.scopes,
    encryptedAccessToken: encryptIntegrationSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken
      ? encryptIntegrationSecret(tokens.refreshToken)
      : null,
    tokenExpiresAt: tokens.expiresAt,
  });
  await recordIntegrationAudit(context, {
    provider,
    action: "connection.connected",
    outcome: "success",
    details: { accountLabel: tokens.accountLabel, scopes: tokens.scopes },
  });
  return toIntegrationConnectionView(record, context);
}

export async function setIntegrationStatus(
  auth: unknown,
  provider: IntegrationProviderId,
  status: IntegrationConnectionStatus,
  lastError: string | null
): Promise<void> {
  const context = await resolveIntegrationContext(
    auth,
    INTEGRATION_PERMISSION_TOOL_NAMES.connect
  );
  const repository = getIntegrationRepository();
  const connection = await repository.findConnection(toIntegrationFilter(context), provider);
  if (!connection) return;
  await repository.updateConnectionStatus(
    toIntegrationFilter(context),
    connection.id,
    status,
    lastError
  );
  await recordIntegrationAudit(context, {
    provider,
    action: "connection.status",
    outcome: status === "error" || status === "reconnect_required" ? "failure" : "success",
    details: { status },
  });
}

export async function disconnectIntegration(
  auth: unknown,
  provider: IntegrationProviderId
): Promise<void> {
  const context = await resolveIntegrationContext(
    auth,
    INTEGRATION_PERMISSION_TOOL_NAMES.disconnect
  );
  const repository = getIntegrationRepository();
  const connection = await repository.findConnection(toIntegrationFilter(context), provider);
  if (!connection) return;
  await repository.deleteConnection(toIntegrationFilter(context), connection.id);
  await recordIntegrationAudit(context, {
    provider,
    action: "connection.disconnected",
    outcome: "success",
  });
}
