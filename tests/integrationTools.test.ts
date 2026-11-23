import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { clearApprovals, getApprovalRequest, submitApprovalDecision } from "../src/lib/approvalWorkflow.ts";
import { encryptIntegrationSecret } from "../src/lib/integrations/credentials.ts";
import {
  executePrepareIntegrationEmailDraft,
  executeSearchIntegrationEmail,
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
} from "../src/tools/integrationTools.ts";
import type { AuthorizationContext } from "../src/lib/permissions.ts";
import {
  installIntegrationRepository,
  resetIntegrationTestRepository,
  seedIntegrationConnection,
} from "./integrationRepositoryStub.ts";

const KEY_NAME = "INTEGRATION_TOKEN_ENCRYPTION_KEY";
const TEST_KEY = "ayF9L3nQ8vR2sT5uW7xZ0aB4cD6eF8gH1jK4mN7pQ9s";

function binding(userId: string) {
  return {
    purpose: "connection",
    provider: "gmail",
    ownerUserId: userId,
    workspaceId: null,
  } as const;
}
const READER_AUTH = {
  userId: "user-reader",
  role: "viewer",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const satisfies AuthorizationContext;
const OPERATOR_AUTH = {
  userId: "user-operator",
  role: "operator",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const satisfies AuthorizationContext;

let originalKey: string | undefined;
let originalFetch: typeof fetch;
let fetchCalls: { url: string; authorization: string | null }[];

beforeEach(() => {
  originalKey = process.env[KEY_NAME];
  originalFetch = globalThis.fetch;
  process.env[KEY_NAME] = TEST_KEY;
  fetchCalls = [];
  clearApprovals();
  const repository = installIntegrationRepository();
  seedIntegrationConnection(repository, {
    userId: READER_AUTH.userId,
    provider: "gmail",
    encryptedAccessToken: encryptIntegrationSecret("google-access-token", binding(READER_AUTH.userId)),
  });
  seedIntegrationConnection(repository, {
    userId: OPERATOR_AUTH.userId,
    provider: "gmail",
    encryptedAccessToken: encryptIntegrationSecret("operator-access-token", binding(OPERATOR_AUTH.userId)),
  });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    fetchCalls.push({ url, authorization: headers.get("authorization") });
    return new Response(
      JSON.stringify({ messages: [{ id: "message-1", snippet: "Quiet please" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env[KEY_NAME];
  else process.env[KEY_NAME] = originalKey;
  globalThis.fetch = originalFetch;
  clearApprovals();
  resetIntegrationTestRepository();
});

test("read-only integration tools call the provider with the decrypted token", async () => {
  const result = await executeSearchIntegrationEmail(
    JSON.stringify({ query: "from:client@example.com", maxResults: 5 }),
    { requestId: "req-read", auth: READER_AUTH }
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected Gmail search to succeed");
  const data = result.data as {
    provider: string;
    items: readonly { id: string }[];
  };
  assert.equal(data.provider, "gmail");
  assert.equal(data.items[0]?.id, "message-1");
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0]!.url, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages/);
  assert.equal(fetchCalls[0]!.authorization, "Bearer google-access-token");
});

test("prepare tools require approval and never contact the provider", async () => {
  const rawArguments = JSON.stringify({
    to: "client@example.com",
    subject: "Follow-up",
    body: "Hello, here is the summary.",
  });
  const pending = await executePrepareIntegrationEmailDraft(rawArguments, {
    requestId: "req-prepare",
    auth: OPERATOR_AUTH,
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected approval request to be created");
  const pendingData = pending.data as { status: string; approvalId: string };
  assert.equal(pendingData.status, "pending_approval");
  assert.ok(pendingData.approvalId);

  const approval = getApprovalRequest(pendingData.approvalId);
  assert.ok(approval);
  assert.equal(approval.toolName, PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME);
  assert.equal(approval.userId, OPERATOR_AUTH.userId);
  submitApprovalDecision(pendingData.approvalId, "approve", OPERATOR_AUTH.userId);

  const fetchCountBeforeExecution = fetchCalls.length;
  const executed = await executePrepareIntegrationEmailDraft(rawArguments, {
    requestId: "req-prepare",
    auth: OPERATOR_AUTH,
    approvalId: pendingData.approvalId,
  });
  assert.equal(executed.ok, true);
  if (!executed.ok) assert.fail("Expected approved prepare operation to execute");
  const executedData = executed.data as {
    status: string;
    payload: { to: string; subject: string };
    notice: string;
  };
  assert.equal(executedData.status, "executed");
  assert.equal(executedData.payload.to, "client@example.com");
  assert.match(executedData.notice, /No message was sent/);
  assert.equal(fetchCalls.length, fetchCountBeforeExecution);
});

test("approval cannot be replayed with different arguments", async () => {
  const rawArguments = JSON.stringify({
    to: "client@example.com",
    subject: "Original",
    body: "Original body.",
  });
  const pending = await executePrepareIntegrationEmailDraft(rawArguments, {
    requestId: "req-replay",
    auth: OPERATOR_AUTH,
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected approval request");
  const approvalId = (pending.data as { approvalId: string }).approvalId;
  submitApprovalDecision(approvalId, "approve", OPERATOR_AUTH.userId);

  const changed = await executePrepareIntegrationEmailDraft(
    JSON.stringify({ to: "other@example.com", subject: "Changed", body: "Changed body." }),
    { requestId: "req-replay", auth: OPERATOR_AUTH, approvalId }
  );
  assert.equal(changed.ok, false);
  if (changed.ok) assert.fail("Changed arguments must be rejected");
  assert.equal(changed.error.code, "PERMISSION_DENIED");
});
