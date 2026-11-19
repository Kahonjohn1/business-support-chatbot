import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleApprovalPost } from "../src/app/api/approvals/route.ts";
import { formatApprovalOutcome } from "../src/lib/approvalOutcome.ts";
import {
  clearApprovals,
  createApprovalRequest,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import { executeCreateProjectTask } from "../src/tools/tasksTool.ts";
import { getTasksForProject, resetDemoTasks } from "../src/tools/taskData.ts";

interface ApprovalResponseBody {
  status?: string;
  message?: string;
  result?: unknown;
}

const ADMIN_AUTH = { userId: "user_approver", role: "admin", isDemo: false } as const;

function post(request: Request): Promise<Response> {
  return handleApprovalPost(request, ADMIN_AUTH);
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createPending(title: string): string {
  const result = executeCreateProjectTask(
    JSON.stringify({ projectName: "Business Support Chatbot", title }),
    { requestId: "req_scenario_test" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");
  const data = result.data as { approvalId?: string };
  assert.ok(data.approvalId);
  return data.approvalId;
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetDemoTasks();
});

test("successful scenario executes the task and reports the outcome", async () => {
  const approvalId = createPending("Scenario success");

  const response = await post(
    jsonRequest({ approvalId, decision: "approve" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  const report = formatApprovalOutcome({
    status: "executed",
    approvalId,
    result: body.result,
  });

  assert.match(report, /Scenario success/);
  assert.match(report, /created in project "Business Support Chatbot"/);
  assert.doesNotMatch(report, /PRJ-|TSK-/);
  assert.equal(getTasksForProject("PRJ-104").length, 3);
});

test("denied scenario writes nothing and reports the rejection", async () => {
  const approvalId = createPending("Scenario denied");

  const response = await post(
    jsonRequest({ approvalId, decision: "reject" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  const report = formatApprovalOutcome({
    status: "rejected",
    approvalId,
  });

  assert.equal(body.status, "rejected");
  assert.match(report, /No changes were made/);
  assert.equal(getTasksForProject("PRJ-104").length, 2);
});

test("failed scenario writes nothing and reports the failure", async () => {
  const approval = createApprovalRequest({
    requestId: "req_scenario_test",
    toolName: "create_project_task",
    rawArguments: "{not-json",
    summary: "Scenario failure",
    details: {},
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 500);

  const body = (await response.json()) as ApprovalResponseBody;
  const report = formatApprovalOutcome({
    status: "failed",
    approvalId: approval.id,
    error: body.message,
  });

  assert.equal(body.status, "failed");
  assert.match(report, /could not be completed/);
  assert.match(report, /No changes were made/);
  assert.equal(getTasksForProject("PRJ-104").length, 2);
});
