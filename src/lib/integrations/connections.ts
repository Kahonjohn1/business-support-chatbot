import "server-only";

import {
  credentialNeedsRewrap,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  rewrapIntegrationSecret,
} from "@/lib/integrations/credentials";
import {
  findIntegrationConnection,
  recordIntegrationAudit,
  sanitizeIntegrationDetails,
  toConnectionCredentialBinding,
  toIntegrationFilter,
  type IntegrationContext,
} from "@/lib/integrations/data";
import { IntegrationError } from "@/lib/integrations/errors";
import { refreshGoogleAccessToken } from "@/lib/integrations/oauth";
import { getIntegrationRepository } from "@/lib/integrations/repository";
import type {
  IntegrationConnectionRecord,
  IntegrationProviderId,
} from "@/lib/integrations/types";

export interface ProviderAccessToken {
  readonly token: string;
  readonly context: IntegrationContext;
  readonly connection: IntegrationConnectionRecord;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return true;
  return timestamp <= Date.now() + 30_000;
}

async function markReconnectRequired(
  context: IntegrationContext,
  connection: IntegrationConnectionRecord,
  lastError: string
): Promise<void> {
  try {
    await getIntegrationRepository().updateConnectionStatus(
      toIntegrationFilter(context),
      connection.id,
      "reconnect_required",
      lastError.slice(0, 200)
    );
    await recordIntegrationAudit(context, {
      provider: connection.provider,
      action: "connection.reconnect_required",
      outcome: "failure",
      details: sanitizeIntegrationDetails({ reason: lastError }),
    });
  } catch {}
}

export async function getProviderAccessToken(
  auth: unknown,
  provider: IntegrationProviderId,
  permissionToolName: string
): Promise<ProviderAccessToken> {
  const { context, connection } = await findIntegrationConnection(
    auth,
    provider,
    permissionToolName
  );

  if (
    connection.status === "reconnect_required" ||
    connection.status === "error" ||
    connection.status === "revoked" ||
    connection.status === "disconnected"
  ) {
    throw new IntegrationError(
      401,
      "RECONNECT_REQUIRED",
      "This integration needs to be reconnected."
    );
  }

  const binding = toConnectionCredentialBinding({
    provider: connection.provider,
    ownerUserId: connection.ownerUserId,
    workspaceId: connection.workspaceId,
  });
  let encryptedAccessToken = connection.encryptedAccessToken;
  let encryptedRefreshToken = connection.encryptedRefreshToken;
  let tokenExpiresAt = connection.tokenExpiresAt;
  let grantedScopes = connection.grantedScopes;

  try {
    if (credentialNeedsRewrap(encryptedAccessToken)) {
      encryptedAccessToken = rewrapIntegrationSecret(encryptedAccessToken, binding);
    }
    if (
      encryptedRefreshToken &&
      credentialNeedsRewrap(encryptedRefreshToken)
    ) {
      encryptedRefreshToken = rewrapIntegrationSecret(encryptedRefreshToken, binding);
    }
    if (
      encryptedAccessToken !== connection.encryptedAccessToken ||
      encryptedRefreshToken !== connection.encryptedRefreshToken
    ) {
      await getIntegrationRepository().updateTokens(
        toIntegrationFilter(context),
        connection.id,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        grantedScopes
      );
    }
  } catch {}

  if (isExpired(tokenExpiresAt)) {
    if (!encryptedRefreshToken) {
      await markReconnectRequired(context, connection, "Access token expired.");
      throw new IntegrationError(
        401,
        "RECONNECT_REQUIRED",
        "This integration needs to be reconnected."
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decryptIntegrationSecret(encryptedRefreshToken, binding);
    } catch {
      await markReconnectRequired(context, connection, "Refresh token could not be read.");
      throw new IntegrationError(
        401,
        "RECONNECT_REQUIRED",
        "This integration needs to be reconnected."
      );
    }

    try {
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      encryptedAccessToken = encryptIntegrationSecret(refreshed.accessToken, binding);
      encryptedRefreshToken = refreshed.refreshToken
        ? encryptIntegrationSecret(refreshed.refreshToken, binding)
        : encryptedRefreshToken;
      tokenExpiresAt = refreshed.expiresAt;
      grantedScopes = refreshed.scopes.length > 0 ? refreshed.scopes : grantedScopes;
      await getIntegrationRepository().updateTokens(
        toIntegrationFilter(context),
        connection.id,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        grantedScopes
      );
    } catch {
      await markReconnectRequired(context, connection, "Token refresh failed.");
      throw new IntegrationError(
        401,
        "RECONNECT_REQUIRED",
        "This integration needs to be reconnected."
      );
    }
  }

  try {
    return {
      token: decryptIntegrationSecret(encryptedAccessToken, binding),
      context,
      connection: {
        ...connection,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        grantedScopes,
      },
    };
  } catch {
    await markReconnectRequired(context, connection, "Access token could not be read.");
    throw new IntegrationError(
      401,
      "RECONNECT_REQUIRED",
      "This integration needs to be reconnected."
    );
  }
}
