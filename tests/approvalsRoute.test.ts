import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  GET,
  handleApprovalPost,
} from "../src/app/api/approvals/route.ts";
import {
  clearApprovals,
  createApprovalRequest,
  getApprovalRequest,
} from "../src/lib/approvalWorkflow.ts";
import { executeCreateProjectTask } from "../src/tools/tasksTool.ts";
import { getTasksForProject, resetDemoTasks } from "../src/tools/taskData.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";

interface ApprovalResponseBody {
  ok?: boolean;
  status?: string;
  approvalId?: string;
  message?: string;
  result?: {
    projectName?: string;
    task?: {
      title: string;
    };
  };
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

function createPending(title = "Route approval task"): string {
  const result = executeCreateProjectTask(
    JSON.stringify({ projectName: "Business Support Chatbot", title }),
    { requestId: "req_route_test" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");
  const data = result.data as { approvalId?: string };
  assert.ok(data.approvalId);
  return data.approvalId as string;
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetDemoTasks();
});

test("approve executes the exact protected operation", async () => {
  const approvalId = createPending("Approve me");

  const response = await post(
    jsonRequest({ approvalId, decision: "approve", role: "viewer" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.ok, true);
  assert.equal(body.status, "executed");
  assert.equal(body.result?.task?.title, "Approve me");

  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
  assert.equal(getTasksForProject("PRJ-104").length, 3);
});

test("repeating an approve request returns the cached result", async () => {
  const approvalId = createPending("Idempotent task");

  const first = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as ApprovalResponseBody;
  assert.equal(firstBody.result?.task?.title, "Idempotent task");
  assert.equal(firstBody.result?.projectName, "Business Support Chatbot");

  const second = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as ApprovalResponseBody;

  assert.equal(secondBody.status, "executed");
  assert.equal(secondBody.result?.task?.title, "Idempotent task");
  assert.deepEqual(secondBody.result, firstBody.result);
  assert.equal(getTasksForProject("PRJ-104").length, 3);
});

test("reject records the decision without writing a task", async () => {
  const approvalId = createPending("Reject me");

  const response = await post(
    jsonRequest({ approvalId, decision: "reject" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "rejected");
  assert.equal(getApprovalRequest(approvalId)?.status, "rejected");
  assert.equal(getTasksForProject("PRJ-104").length, 2);

  const repeated = await post(
    jsonRequest({ approvalId, decision: "reject" })
  );
  assert.equal(repeated.status, 200);
});

test("expired approvals cannot be approved", async () => {
  const approval = createApprovalRequest({
    requestId: "req_route_test",
    toolName: "create_project_task",
    rawArguments: JSON.stringify({
      projectName: "Business Support Chatbot",
      title: "Expired",
    }),
    summary: 'Create task "Expired"',
    details: {},
    ttlMs: -1,
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 409);
  assert.equal(getApprovalRequest(approval.id)?.status, "expired");
});

test("execution failures mark the approval as terminal", async () => {
  const approval = createApprovalRequest({
    requestId: "req_route_test",
    toolName: "create_project_task",
    rawArguments: "{not-json",
    summary: "Invalid approved operation",
    details: {},
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 500);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "failed");
  assert.equal(getApprovalRequest(approval.id)?.status, "failed");
  assert.equal(getTasksForProject("PRJ-104").length, 2);

  const replay = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(replay.status, 409);
});

test("missing authorization context is rejected", async () => {
  const approval = createApprovalRequest({
    toolName: "create_project_task",
    rawArguments: JSON.stringify({
      projectName: "Business Support Chatbot",
      title: "No auth",
    }),
    summary: "No auth",
    details: {},
    requestId: "req-no-auth",
  });
  const response = await handleApprovalPost(
    jsonRequest({ approvalId: approval.id, decision: "approve" }),
    undefined
  );
  assert.equal(response.status, 401);
  assert.equal(getApprovalRequest(approval.id)?.status, "pending");
});

test("unknown approval identifiers return 404", async () => {
  const response = await post(
    jsonRequest({ approvalId: "appr_missing", decision: "approve" })
  );
  assert.equal(response.status, 404);
});

test("the approval endpoint does not expose audit logs", async () => {
  const response = await GET();
  assert.equal(response.status, 403);

  const body = (await response.json()) as Record<string, unknown>;
  assert.equal("auditLogs" in body, false);
});
