import "server-only";

import { IntegrationError } from "@/lib/integrations/errors";
import { isIntegrationProviderId } from "@/lib/integrations/providers";
import type {
  IntegrationAuditRecord,
  IntegrationAuditRecordInput,
  IntegrationConnectionRecord,
  IntegrationConnectionScope,
  IntegrationConnectionStatus,
  IntegrationProviderId,
} from "@/lib/integrations/types";

export interface IntegrationConnectionFilter {
  readonly userId: string;
  readonly scope: IntegrationConnectionScope;
  readonly workspaceId: string | null;
}

export interface IntegrationConnectionUpsert extends IntegrationConnectionFilter {
  readonly provider: IntegrationProviderId;
  readonly status: IntegrationConnectionStatus;
  readonly accountLabel: string | null;
  readonly grantedScopes: readonly string[];
  readonly encryptedAccessToken: string;
  readonly encryptedRefreshToken: string | null;
  readonly tokenExpiresAt: string | null;
}

export interface IntegrationRepository {
  listConnections(
    filter: IntegrationConnectionFilter
  ): Promise<readonly IntegrationConnectionRecord[]>;
  findConnection(
    filter: IntegrationConnectionFilter,
    provider: IntegrationProviderId
  ): Promise<IntegrationConnectionRecord | null>;
  findConnectionById(
    filter: IntegrationConnectionFilter,
    connectionId: string
  ): Promise<IntegrationConnectionRecord | null>;
  upsertConnection(
    input: IntegrationConnectionUpsert
  ): Promise<IntegrationConnectionRecord>;
  updateConnectionStatus(
    filter: IntegrationConnectionFilter,
    connectionId: string,
    status: IntegrationConnectionStatus,
    lastError: string | null
  ): Promise<void>;
  updateTokens(
    filter: IntegrationConnectionFilter,
    connectionId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken: string | null,
    tokenExpiresAt: string | null,
    grantedScopes: readonly string[]
  ): Promise<void>;
  deleteConnection(
    filter: IntegrationConnectionFilter,
    connectionId: string
  ): Promise<void>;
  appendAudit(
    userId: string,
    event: IntegrationAuditRecordInput
  ): Promise<IntegrationAuditRecord>;
  listAudit(
    filter: IntegrationConnectionFilter,
    limit: number
  ): Promise<readonly IntegrationAuditRecord[]>;
}

const STATUSES: readonly IntegrationConnectionStatus[] = [
  "disconnected",
  "connecting",
  "connected",
  "reconnect_required",
  "error",
  "revoked",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireUserId(userId: string): string {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new IntegrationError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
  }
  return userId.trim();
}

function requireConnectionId(connectionId: string): string {
  if (typeof connectionId !== "string" || connectionId.trim() === "") {
    throw new IntegrationError(400, "INVALID_REQUEST", "Integration connection id is required.");
  }
  return connectionId.trim();
}

function requireScope(scope: IntegrationConnectionScope): IntegrationConnectionScope {
  if (scope !== "personal" && scope !== "workspace") {
    throw new IntegrationError(400, "INVALID_REQUEST", "Invalid connection scope.");
  }
  return scope;
}

function requireWorkspaceId(
  scope: IntegrationConnectionScope,
  workspaceId: string | null
): string | null {
  if (scope === "personal") return null;
  if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
    throw new IntegrationError(
      403,
      "PERMISSION_DENIED",
      "A verified business workspace is required."
    );
  }
  return workspaceId.trim();
}

function normalizeFilter(filter: IntegrationConnectionFilter): IntegrationConnectionFilter {
  const userId = requireUserId(filter.userId);
  const scope = requireScope(filter.scope);
  return { userId, scope, workspaceId: requireWorkspaceId(scope, filter.workspaceId) };
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration record.");
  }
  return value;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string
): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration record.");
  }
  return value;
}

function readScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readProvider(value: unknown): IntegrationProviderId {
  if (!isIntegrationProviderId(value)) {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration provider.");
  }
  return value;
}

function readStatus(value: unknown): IntegrationConnectionStatus {
  if (typeof value !== "string" || !STATUSES.includes(value as IntegrationConnectionStatus)) {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration status.");
  }
  return value as IntegrationConnectionStatus;
}

export function mapIntegrationConnection(value: unknown): IntegrationConnectionRecord {
  if (!isRecord(value)) {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration record.");
  }
  return {
    id: readString(value, "id"),
    scope: requireScope(value.scope as IntegrationConnectionScope),
    ownerUserId: readString(value, "owner_user_id"),
    workspaceId: readNullableString(value, "workspace_id"),
    provider: readProvider(value.provider),
    status: readStatus(value.status),
    accountLabel: readNullableString(value, "account_label"),
    grantedScopes: readScopes(value.granted_scopes),
    encryptedAccessToken: readString(value, "encrypted_access_token"),
    encryptedRefreshToken: readNullableString(value, "encrypted_refresh_token"),
    tokenExpiresAt: readNullableString(value, "token_expires_at"),
    lastError: readNullableString(value, "last_error"),
    createdAt: readString(value, "created_at"),
    updatedAt: readString(value, "updated_at"),
  };
}

function mapIntegrationAudit(value: unknown): IntegrationAuditRecord {
  if (!isRecord(value)) {
    throw new IntegrationError(500, "STORAGE_UNAVAILABLE", "Invalid integration audit record.");
  }
  const outcome = value.outcome;
  return {
    id: readString(value, "id"),
    actorUserId: readString(value, "actor_user_id"),
    scope: requireScope(value.scope as IntegrationConnectionScope),
    workspaceId: readNullableString(value, "workspace_id"),
    provider: readProvider(value.provider),
    action: readString(value, "action"),
    outcome:
      outcome === "success" || outcome === "failure" || outcome === "denied" || outcome === "pending"
        ? outcome
        : "failure",
    details: isRecord(value.details) ? value.details : {},
    createdAt: readString(value, "created_at"),
  };
}

function storageError(operation: string, message: string): IntegrationError {
  return new IntegrationError(
    503,
    "STORAGE_UNAVAILABLE",
    `Integration ${operation} is unavailable. ${message.slice(0, 120)}`
  );
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

const supabaseIntegrationRepository: IntegrationRepository = {
  async listConnections(rawFilter) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_integration_connections", {
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
    });
    if (error) throw storageError("connection listing", error.message);
    return (data ?? []).map(mapIntegrationConnection);
  },

  async findConnection(rawFilter, provider) {
    const connections = await this.listConnections(rawFilter);
    return connections.find((connection) => connection.provider === provider) ?? null;
  },

  async findConnectionById(rawFilter, rawConnectionId) {
    const filter = normalizeFilter(rawFilter);
    const connectionId = requireConnectionId(rawConnectionId);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_integration_connection", {
      p_connection_id: connectionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
    });
    if (error) throw storageError("connection lookup", error.message);
    return data ? mapIntegrationConnection(data) : null;
  },

  async upsertConnection(rawInput) {
    const input = rawInput;
    const filter = normalizeFilter(input);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("upsert_integration_connection", {
        p_scope: filter.scope,
        p_workspace_id: filter.workspaceId,
        p_provider: input.provider,
        p_status: input.status,
        p_account_label: input.accountLabel,
        p_granted_scopes: [...input.grantedScopes],
        p_access_token_encrypted: input.encryptedAccessToken,
        p_refresh_token_encrypted: input.encryptedRefreshToken,
        p_token_expires_at: input.tokenExpiresAt,
      })
      .single();
    if (error) throw storageError("connection save", error.message);
    if (!data) throw storageError("connection save", "No connection was returned.");
    return mapIntegrationConnection(data);
  },

  async updateConnectionStatus(rawFilter, rawConnectionId, status, lastError) {
    const filter = normalizeFilter(rawFilter);
    const connectionId = requireConnectionId(rawConnectionId);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_integration_connection_status", {
      p_connection_id: connectionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_status: status,
      p_last_error: lastError,
    });
    if (error) throw storageError("status update", error.message);
  },

  async updateTokens(
    rawFilter,
    rawConnectionId,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiresAt,
    grantedScopes
  ) {
    const filter = normalizeFilter(rawFilter);
    const connectionId = requireConnectionId(rawConnectionId);
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_integration_tokens", {
      p_connection_id: connectionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_access_token_encrypted: encryptedAccessToken,
      p_refresh_token_encrypted: encryptedRefreshToken,
      p_token_expires_at: tokenExpiresAt,
      p_granted_scopes: [...grantedScopes],
    });
    if (error) throw storageError("token update", error.message);
  },

  async deleteConnection(rawFilter, rawConnectionId) {
    const filter = normalizeFilter(rawFilter);
    const connectionId = requireConnectionId(rawConnectionId);
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_integration_connection", {
      p_connection_id: connectionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
    });
    if (error) throw storageError("connection removal", error.message);
  },

  async appendAudit(rawUserId, event) {
    requireUserId(rawUserId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("record_integration_audit_event", {
        p_scope: event.scope,
        p_workspace_id: event.workspaceId,
        p_provider: event.provider,
        p_action: event.action,
        p_outcome: event.outcome,
        p_details: event.details ?? {},
      })
      .single();
    if (error) throw storageError("audit recording", error.message);
    if (!data) throw storageError("audit recording", "No audit event was returned.");
    return mapIntegrationAudit(data);
  },

  async listAudit(rawFilter, limit) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_integration_audit_events", {
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_limit: Math.max(1, Math.min(limit, 200)),
    });
    if (error) throw storageError("audit listing", error.message);
    return (data ?? []).map(mapIntegrationAudit);
  },
};

let activeRepository: IntegrationRepository = supabaseIntegrationRepository;

export function setIntegrationRepository(repository: IntegrationRepository): void {
  activeRepository = repository;
}

export function resetIntegrationRepository(): void {
  activeRepository = supabaseIntegrationRepository;
}

export function getIntegrationRepository(): IntegrationRepository {
  return activeRepository;
}
