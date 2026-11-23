import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  listIntegrationViews,
  recordIntegrationAudit,
  sanitizeIntegrationDetails,
  toIntegrationConnectionView,
  type IntegrationContext,
} from "../src/lib/integrations/data.ts";
import type { AuthorizationContext } from "../src/lib/permissions.ts";
import {
  installIntegrationRepository,
  resetIntegrationTestRepository,
  seedIntegrationConnection,
} from "./integrationRepositoryStub.ts";

const AUTH = {
  userId: "user-integration",
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const satisfies AuthorizationContext;

let repository: ReturnType<typeof installIntegrationRepository>;

beforeEach(() => {
  repository = installIntegrationRepository();
});

afterEach(() => {
  resetIntegrationTestRepository();
});

test("integration views never expose encrypted tokens", async () => {
  seedIntegrationConnection(repository, {
    userId: AUTH.userId,
    provider: "gmail",
    encryptedAccessToken: "encrypted-access-token",
    encryptedRefreshToken: "encrypted-refresh-token",
  });

  const views = await listIntegrationViews(AUTH);
  const gmail = views.find((view) => view.id === "gmail");
  assert.ok(gmail);
  assert.equal(gmail.connection?.accountLabel, "user@example.com");
  assert.equal(JSON.stringify(views).includes("encrypted-access-token"), false);
  assert.equal(JSON.stringify(views).includes("encrypted-refresh-token"), false);
});

test("connection views allow operators to manage workspaces", () => {
  const context: IntegrationContext = {
    userId: AUTH.userId,
    scope: "workspace",
    workspaceId: "workspace-1",
    role: "operator",
    canManage: true,
    auth: {
      userId: AUTH.userId,
      role: "operator",
      workspaceKind: "shared",
      source: "verified_membership",
      workspaceId: "workspace-1",
      isDemo: false,
    },
  };
  const record = seedIntegrationConnection(repository, {
    userId: AUTH.userId,
    provider: "google_calendar",
    encryptedAccessToken: "encrypted-access-token",
    workspaceId: "workspace-1",
  });

  const view = toIntegrationConnectionView(record, context);
  assert.equal(view.canManage, true);
  assert.equal("encryptedAccessToken" in view, false);
});

test("audit details redact sensitive keys", async () => {
  const context: IntegrationContext = {
    userId: AUTH.userId,
    scope: "personal",
    workspaceId: null,
    role: "operator",
    canManage: true,
    auth: AUTH,
  };

  const sanitized = sanitizeIntegrationDetails({
    accessToken: "secret-value",
    accountLabel: "user@example.com",
    nested: { refresh_token: "another-secret" },
  });
  assert.equal(sanitized.accessToken, "[REDACTED]");
  assert.equal(sanitized.accountLabel, "user@example.com");
  assert.deepEqual(sanitized.nested, { refresh_token: "[REDACTED]" });

  await recordIntegrationAudit(context, {
    provider: "gmail",
    action: "tool.test",
    outcome: "success",
    details: sanitized,
  });
  assert.equal(repository.audits.length, 1);
  assert.equal(JSON.stringify(repository.audits).includes("secret-value"), false);
});
