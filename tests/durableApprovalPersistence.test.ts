import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  clearApprovals,
  createApprovalRecord,
  getApprovalRecord,
} from "../src/lib/approvalWorkflow.ts";
import {
  clearAuditLogs,
  getDurableAuditLogs,
  persistAuditEvent,
  setAuditStore,
  selectMemoryAuditStore,
} from "../src/lib/auditLog.ts";
import {
  handleApprovalDecision,
} from "../src/lib/approvalDecision.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  FakeHybridWorkspaceRepository,
  USER_A,
  USER_B,
  WORKSPACE_A,
  WORKSPACE_B,
  sharedAuth,
} from "./workspaceProjectStub.ts";
import { AUTH_A, AUTH_B } from "./personalRepositoryStub.ts";

const APPROVAL_TOOL = "create_project_task";
const DECISION_OPTIONS = {
  allowedToolNames: [APPROVAL_TOOL],
  requireOwnership: true,
} as const;

function decisionRequest(
  approvalId: string,
  extra: Record<string, unknown> = {}
): Request {
  return new Request("http://localhost/api/approvals/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId, decision: "reject", ...extra }),
  });
}

function pendingApproval(overrides: {
  userId: string;
  workspaceId?: string;
  workspaceKind?: "personal" | "shared";
}) {
  return createApprovalRecord({
    requestId: "req_durable_approval",
    toolName: APPROVAL_TOOL,
    rawArguments: JSON.stringify({ projectId: "PRJ-1", title: "Task" }),
    summary: "Create task",
    details: { projectId: "PRJ-1" },
    userId: overrides.userId,
    resourceId: "PRJ-1",
    ...(overrides.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
    workspaceKind: overrides.workspaceKind ?? "personal",
  });
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  const hybrid = new FakeHybridWorkspaceRepository();
  hybrid.addMembership(WORKSPACE_A, USER_A, "staff");
  hybrid.addMembership(WORKSPACE_A, USER_B, "viewer");
  hybrid.addMembership(WORKSPACE_B, USER_A, "staff");
  setHybridWorkspaceRepository(hybrid);
});

afterEach(() => {
  selectMemoryAuditStore();
  resetHybridWorkspaceRepository();
});

test("durable approval records preserve server-only ownership and resource binding", async () => {
  const created = await pendingApproval({
    userId: USER_A,
    workspaceId: WORKSPACE_A,
    workspaceKind: "shared",
  });
  const loaded = await getApprovalRecord(created.id);

  assert.equal(loaded?.userId, USER_A);
  assert.equal(loaded?.resourceId, "PRJ-1");
  assert.equal(loaded?.workspaceId, WORKSPACE_A);
  assert.equal(loaded?.workspaceKind, "shared");
  assert.equal(loaded?.status, "pending");
  assert.equal(loaded?.requestId, "req_durable_approval");
  assert.equal(loaded?.toolName, APPROVAL_TOOL);
});

test("another user cannot decide a personal approval", async () => {
  const approval = await pendingApproval({ userId: USER_A });
  const response = await handleApprovalDecision(
    decisionRequest(approval.id),
    AUTH_B,
    DECISION_OPTIONS
  );

  assert.equal(response.status, 404);
  assert.equal((await getApprovalRecord(approval.id))?.status, "pending");
});

test("shared approval decisions require active membership and write permission", async () => {
  const approval = await pendingApproval({
    userId: USER_A,
    workspaceId: WORKSPACE_A,
    workspaceKind: "shared",
  });

  const allowed = await handleApprovalDecision(
    decisionRequest(approval.id),
    sharedAuth(WORKSPACE_A, USER_A, "staff"),
    DECISION_OPTIONS
  );
  assert.equal(allowed.status, 200);
  assert.equal((await getApprovalRecord(approval.id))?.status, "rejected");

  const crossWorkspace = await pendingApproval({
    userId: USER_A,
    workspaceId: WORKSPACE_A,
    workspaceKind: "shared",
  });
  const deniedWorkspace = await handleApprovalDecision(
    decisionRequest(crossWorkspace.id),
    sharedAuth(WORKSPACE_B, USER_A, "staff"),
    DECISION_OPTIONS
  );
  assert.equal(deniedWorkspace.status, 404);
  assert.equal((await getApprovalRecord(crossWorkspace.id))?.status, "pending");

  const viewer = await pendingApproval({
    userId: USER_B,
    workspaceId: WORKSPACE_A,
    workspaceKind: "shared",
  });
  const deniedRole = await handleApprovalDecision(
    decisionRequest(viewer.id),
    sharedAuth(WORKSPACE_A, USER_B, "viewer"),
    DECISION_OPTIONS
  );
  assert.equal(deniedRole.status, 403);
  assert.equal((await getApprovalRecord(viewer.id))?.status, "pending");
});

test("replayed decisions cannot change or duplicate an approval outcome", async () => {
  const approval = await pendingApproval({ userId: USER_A });
  const auth = AUTH_A;

  const first = await handleApprovalDecision(
    decisionRequest(approval.id),
    auth,
    DECISION_OPTIONS
  );
  const replay = await handleApprovalDecision(
    decisionRequest(approval.id),
    auth,
    DECISION_OPTIONS
  );

  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  const firstBody = (await first.json()) as { status?: string };
  const replayBody = (await replay.json()) as { status?: string };
  assert.equal(firstBody.status, "rejected");
  assert.equal(replayBody.status, "rejected");
  assert.equal((await getApprovalRecord(approval.id))?.status, "rejected");
});

test("no model-supplied identity or unauthenticated caller can self-approve", async () => {
  const approval = await pendingApproval({ userId: USER_A });
  const forged = decisionRequest(approval.id, {
    userId: USER_A,
    decisionBy: "ai-model",
    role: "admin",
    workspaceId: null,
  });

  const unauthenticated = await handleApprovalDecision(
    forged,
    undefined,
    DECISION_OPTIONS
  );
  assert.equal(unauthenticated.status, 401);

  const otherUser = await handleApprovalDecision(
    forged,
    AUTH_B,
    DECISION_OPTIONS
  );
  assert.equal(otherUser.status, 404);
  assert.equal((await getApprovalRecord(approval.id))?.status, "pending");
});

test("durable audit records are sanitized and persistence failures surface", async () => {
  await persistAuditEvent({
    requestId: "req_durable_audit",
    toolName: APPROVAL_TOOL,
    operation: "permission_check",
    status: "denied",
    details: {
      apiKey: "secret-value",
      nested: { token: "secret-token", visible: "keep" },
    },
  });

  const events = await getDurableAuditLogs({ requestId: "req_durable_audit" });
  assert.equal(events.length, 1);
  const details = events[0].details as Record<string, unknown>;
  assert.equal(details.apiKey, "[REDACTED]");
  assert.equal((details.nested as Record<string, unknown>).token, "[REDACTED]");
  assert.equal((details.nested as Record<string, unknown>).visible, "keep");

  setAuditStore({
    append: async () => {
      throw new Error("audit store unavailable");
    },
    list: async () => [],
  });
  await assert.rejects(
    () =>
      persistAuditEvent({
        requestId: "req_failed_audit",
        toolName: APPROVAL_TOOL,
        operation: "permission_check",
        status: "denied",
      }),
    /audit store unavailable/
  );
});
