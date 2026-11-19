import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginApprovalExecution,
  clearApprovals,
  createApprovalRequest,
  getApprovalRequest,
  markApprovalExecuted,
  markApprovalFailed,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";

function createApproval(overrides?: { ttlMs?: number }) {
  return createApprovalRequest({
    requestId: "req_approval_test",
    toolName: "create_project_task",
    rawArguments: JSON.stringify({ projectId: "PRJ-104", title: "Test task" }),
    summary: 'Create task "Test task" in project PRJ-104',
    details: { projectId: "PRJ-104" },
    ...(overrides?.ttlMs !== undefined ? { ttlMs: overrides.ttlMs } : {}),
  });
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
});

test("approval tokens are opaque, unique, and cryptographically sized", () => {
  const first = createApproval();
  const second = createApproval();

  assert.match(first.id, /^appr_[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.status, "pending");
});

test("an approval decision is recorded once and cannot be replayed", () => {
  const approval = createApproval();

  const decided = submitApprovalDecision(approval.id, "approve", "tester");
  assert.equal(decided.status, "approved");
  assert.equal(decided.decisionBy, "tester");
  assert.ok(decided.decisionTimestamp);

  assert.throws(
    () => submitApprovalDecision(approval.id, "reject"),
    /already "approved"/
  );
});

test("an expired approval cannot be decided or executed", () => {
  const approval = createApproval({ ttlMs: -1 });

  const expired = getApprovalRequest(approval.id);
  assert.equal(expired?.status, "expired");
  assert.throws(
    () => submitApprovalDecision(approval.id, "approve"),
    /expired/
  );
  assert.throws(
    () => beginApprovalExecution(approval.id),
    /cannot be executed/
  );
});

test("approved execution is reserved once and caches its result", () => {
  const approval = createApproval();
  submitApprovalDecision(approval.id, "approve");

  beginApprovalExecution(approval.id);
  assert.equal(getApprovalRequest(approval.id)?.status, "executing");

  const executed = markApprovalExecuted(approval.id, { taskId: "TSK-TEST" });
  assert.equal(executed.status, "executed");
  assert.deepEqual(executed.executionResult, { taskId: "TSK-TEST" });
  assert.ok(executed.executionTimestamp);

  assert.throws(
    () => beginApprovalExecution(approval.id),
    /cannot be executed/
  );
  assert.throws(
    () => markApprovalExecuted(approval.id),
    /already been executed/
  );
});

test("a failed execution becomes terminal and cannot be retried", () => {
  const approval = createApproval();
  submitApprovalDecision(approval.id, "approve");
  beginApprovalExecution(approval.id);

  const failed = markApprovalFailed(approval.id, "Task creation failed.");
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, "Task creation failed.");

  const repeated = markApprovalFailed(approval.id, "Different reason.");
  assert.equal(repeated.status, "failed");
  assert.equal(repeated.failureReason, "Task creation failed.");

  assert.throws(
    () => beginApprovalExecution(approval.id),
    /cannot be executed/
  );
});

test("a rejected approval cannot execute", () => {
  const approval = createApproval();
  submitApprovalDecision(approval.id, "reject");

  assert.equal(getApprovalRequest(approval.id)?.status, "rejected");
  assert.throws(
    () => beginApprovalExecution(approval.id),
    /cannot be executed/
  );
});
