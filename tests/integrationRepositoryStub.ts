import {
  resetIntegrationRepository,
  setIntegrationRepository,
  type IntegrationConnectionFilter,
  type IntegrationRepository,
  type IntegrationConnectionUpsert,
} from "../src/lib/integrations/repository.ts";
import type {
  IntegrationAuditRecord,
  IntegrationAuditRecordInput,
  IntegrationConnectionRecord,
  IntegrationProviderId,
} from "../src/lib/integrations/types.ts";

function matches(
  record: { scope: string; ownerUserId: string; workspaceId: string | null },
  filter: IntegrationConnectionFilter
): boolean {
  if (record.scope !== filter.scope) return false;
  if (filter.scope === "personal") return record.ownerUserId === filter.userId;
  return record.workspaceId === filter.workspaceId;
}

export class FakeIntegrationRepository implements IntegrationRepository {
  readonly connections: IntegrationConnectionRecord[] = [];
  readonly audits: IntegrationAuditRecord[] = [];

  async listConnections(filter: IntegrationConnectionFilter) {
    return this.connections.filter((record) => matches(record, filter));
  }

  async findConnection(filter: IntegrationConnectionFilter, provider: IntegrationProviderId) {
    return this.connections.find(
      (record) => matches(record, filter) && record.provider === provider
    ) ?? null;
  }

  async findConnectionById(filter: IntegrationConnectionFilter, connectionId: string) {
    return this.connections.find(
      (record) => matches(record, filter) && record.id === connectionId
    ) ?? null;
  }

  async upsertConnection(input: IntegrationConnectionUpsert) {
    const existing = await this.findConnection(input, input.provider);
    const now = new Date().toISOString();
    if (existing) {
      const updated: IntegrationConnectionRecord = {
        ...existing,
        status: input.status,
        accountLabel: input.accountLabel,
        grantedScopes: [...input.grantedScopes],
        encryptedAccessToken: input.encryptedAccessToken,
        encryptedRefreshToken: input.encryptedRefreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        lastError: null,
        updatedAt: now,
      };
      this.connections[this.connections.indexOf(existing)] = updated;
      return updated;
    }
    const record: IntegrationConnectionRecord = {
      id: `integration-${this.connections.length + 1}`,
      scope: input.scope,
      ownerUserId: input.userId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      status: input.status,
      accountLabel: input.accountLabel,
      grantedScopes: [...input.grantedScopes],
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken,
      tokenExpiresAt: input.tokenExpiresAt,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.push(record);
    return record;
  }

  async updateConnectionStatus(
    filter: IntegrationConnectionFilter,
    connectionId: string,
    status: IntegrationConnectionRecord["status"],
    lastError: string | null
  ) {
    const record = await this.findConnectionById(filter, connectionId);
    if (!record) return;
    const index = this.connections.indexOf(record);
    this.connections[index] = { ...record, status, lastError, updatedAt: new Date().toISOString() };
  }

  async updateTokens(
    filter: IntegrationConnectionFilter,
    connectionId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken: string | null,
    tokenExpiresAt: string | null,
    grantedScopes: readonly string[]
  ) {
    const record = await this.findConnectionById(filter, connectionId);
    if (!record) return;
    const index = this.connections.indexOf(record);
    this.connections[index] = {
      ...record,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      grantedScopes: [...grantedScopes],
      status: "connected",
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async deleteConnection(filter: IntegrationConnectionFilter, connectionId: string) {
    const record = await this.findConnectionById(filter, connectionId);
    if (!record) return;
    this.connections.splice(this.connections.indexOf(record), 1);
  }

  async appendAudit(userId: string, event: IntegrationAuditRecordInput) {
    const record: IntegrationAuditRecord = {
      ...event,
      id: `audit-${this.audits.length + 1}`,
      actorUserId: userId,
      createdAt: new Date().toISOString(),
    };
    this.audits.push(record);
    return record;
  }

  async listAudit(filter: IntegrationConnectionFilter, limit: number) {
    return this.audits
      .filter(
        (record) =>
          record.scope === filter.scope &&
          (filter.scope === "personal"
            ? record.actorUserId === filter.userId
            : record.workspaceId === filter.workspaceId)
      )
      .slice(0, limit);
  }
}

export function installIntegrationRepository(
  repository: FakeIntegrationRepository = new FakeIntegrationRepository()
): FakeIntegrationRepository {
  setIntegrationRepository(repository);
  return repository;
}

export function resetIntegrationTestRepository(): void {
  resetIntegrationRepository();
}

export function seedIntegrationConnection(
  repository: FakeIntegrationRepository,
  input: {
    readonly userId: string;
    readonly provider: IntegrationProviderId;
    readonly encryptedAccessToken: string;
    readonly encryptedRefreshToken?: string | null;
    readonly workspaceId?: string | null;
    readonly status?: IntegrationConnectionRecord["status"];
    readonly grantedScopes?: readonly string[];
  }
): IntegrationConnectionRecord {
  const now = new Date().toISOString();
  const scope = input.workspaceId ? "workspace" : "personal";
  const record: IntegrationConnectionRecord = {
    id: `integration-${repository.connections.length + 1}`,
    ownerUserId: input.userId,
    scope,
    workspaceId: input.workspaceId ?? null,
    provider: input.provider,
    status: input.status ?? "connected",
    accountLabel: "user@example.com",
    grantedScopes: input.grantedScopes ?? [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
    encryptedAccessToken: input.encryptedAccessToken,
    encryptedRefreshToken: input.encryptedRefreshToken ?? null,
    tokenExpiresAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  repository.connections.push(record);
  return record;
}
