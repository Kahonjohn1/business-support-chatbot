export const INTEGRATION_PROVIDER_IDS = ["gmail", "google_calendar"] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

export type IntegrationConnectionScope = "personal" | "workspace";

export type IntegrationConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnect_required"
  | "error"
  | "revoked";

export type IntegrationCapability =
  | "email:search"
  | "email:read"
  | "email:draft"
  | "calendar:read"
  | "calendar:availability"
  | "calendar:draft";

export interface IntegrationProviderDefinition {
  readonly id: IntegrationProviderId;
  readonly label: string;
  readonly description: string;
  readonly authFamily: "google_oauth2";
  readonly requiredScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly capabilities: readonly IntegrationCapability[];
}

export interface IntegrationConnectionRecord {
  readonly id: string;
  readonly scope: IntegrationConnectionScope;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly provider: IntegrationProviderId;
  readonly status: IntegrationConnectionStatus;
  readonly accountLabel: string | null;
  readonly grantedScopes: readonly string[];
  readonly encryptedAccessToken: string;
  readonly encryptedRefreshToken: string | null;
  readonly tokenExpiresAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationConnectionView {
  readonly id: string;
  readonly scope: IntegrationConnectionScope;
  readonly provider: IntegrationProviderId;
  readonly status: IntegrationConnectionStatus;
  readonly accountLabel: string | null;
  readonly grantedScopes: readonly string[];
  readonly tokenExpiresAt: string | null;
  readonly lastError: string | null;
  readonly canManage: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationProviderView {
  readonly id: IntegrationProviderId;
  readonly label: string;
  readonly description: string;
  readonly configured: boolean;
  readonly missingConfig: readonly string[];
  readonly requiredScopes: readonly string[];
  readonly capabilities: readonly IntegrationCapability[];
  readonly connection: IntegrationConnectionView | null;
}

export interface IntegrationAuditRecordInput {
  readonly scope: IntegrationConnectionScope;
  readonly workspaceId: string | null;
  readonly provider: IntegrationProviderId;
  readonly action: string;
  readonly outcome: "success" | "failure" | "denied" | "pending";
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface IntegrationAuditRecord extends IntegrationAuditRecordInput {
  readonly id: string;
  readonly actorUserId: string;
  readonly createdAt: string;
}
