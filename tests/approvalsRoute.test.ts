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
import { executeCreateProject } from "../src/tools/projectStatusTool.ts";
import { executeCreateProjectTask } from "../src/tools/tasksTool.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import {
  ADMIN_AUTH,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";

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

const PROJECT_NAME = "Business Support Chatbot";

function post(request: Request): Promise<Response> {
  return handleApprovalPost(request, ADMIN_AUTH);
}

function postAs(
  auth: typeof ADMIN_AUTH | typeof AUTH_B,
  request: Request
): Promise<Response> {
  return handleApprovalPost(request, auth);
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createPending(title = "Route approval task"): Promise<string> {
  const result = await executeCreateProjectTask(
    JSON.stringify({ projectName: PROJECT_NAME, title }),
    { requestId: "req_route_test", auth: ADMIN_AUTH }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");
  const data = result.data as { approvalId?: string };
  assert.ok(data.approvalId);
  return data.approvalId;
}

let repository: FakePersonalRepository;

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetPersonalRepository();
  repository = installPersonalRepository(new FakePersonalRepository());
  seedProject(repository, ADMIN_AUTH.userId, PROJECT_NAME, "active");
});

test("approve executes the exact protected operation", async () => {
  const approvalId = await createPending("Approve me");

  const response = await post(
    jsonRequest({ approvalId, decision: "approve", role: "viewer" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.ok, true);
  assert.equal(body.status, "executed");
  assert.equal(body.result?.task?.title, "Approve me");
  assert.equal(body.result?.projectName, PROJECT_NAME);

  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
  assert.equal(repository.tasks.length, 1);
});

test("repeating an approve request returns the cached result", async () => {
  const approvalId = await createPending("Idempotent task");

  const first = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as ApprovalResponseBody;
  assert.equal(firstBody.result?.task?.title, "Idempotent task");
  assert.equal(firstBody.result?.projectName, PROJECT_NAME);

  const second = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as ApprovalResponseBody;

  assert.equal(secondBody.status, "executed");
  assert.equal(secondBody.result?.task?.title, "Idempotent task");
  assert.deepEqual(secondBody.result, firstBody.result);
  assert.equal(repository.tasks.length, 1);
});

test("reject records the decision without writing a task", async () => {
  const approvalId = await createPending("Reject me");

  const response = await post(
    jsonRequest({ approvalId, decision: "reject" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "rejected");
  assert.equal(getApprovalRequest(approvalId)?.status, "rejected");
  assert.equal(repository.tasks.length, 0);

  const repeated = await post(
    jsonRequest({ approvalId, decision: "reject" })
  );
  assert.equal(repeated.status, 200);
});

test("another user cannot approve a legacy approval", async () => {
  const approvalId = await createPending("Cross-user approve");

  const response = await postAs(
    AUTH_B,
    jsonRequest({ approvalId, decision: "approve" })
  );

  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
});

test("another user cannot reject a legacy approval", async () => {
  const approvalId = await createPending("Cross-user reject");

  const response = await postAs(
    AUTH_B,
    jsonRequest({ approvalId, decision: "reject" })
  );

  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
});

test("the legacy route rejects tools outside its allowlist", async () => {
  const approval = createApprovalRequest({
    requestId: "req_route_test",
    toolName: "list_projects",
    rawArguments: "{}",
    summary: "Read projects",
    details: {},
    userId: ADMIN_AUTH.userId,
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );

  assert.equal(response.status, 403);
  assert.equal(getApprovalRequest(approval.id)?.status, "pending");
  assert.equal(repository.createTaskCalls, 0);
});

test("the legacy route creates an approved project for its owner", async () => {
  const rawArguments = JSON.stringify({ name: "Legacy Project" });
  const pending = await executeCreateProject(rawArguments, {
    requestId: "req_route_test_create_project",
    auth: ADMIN_AUTH,
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected a pending project approval");
  const approvalId = (pending.data as { approvalId?: string }).approvalId;
  assert.ok(approvalId);

  const response = await post(jsonRequest({ approvalId, decision: "approve" }));
  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "executed");
  assert.equal(repository.projects.length, 2);
  assert.equal(repository.projects[1].name, "Legacy Project");
  assert.equal(repository.projects[1].userId, ADMIN_AUTH.userId);
});

test("client-supplied identity cannot redirect a legacy approval", async () => {
  const approvalId = await createPending("Server-owned approval");

  const response = await post(
    jsonRequest({
      approvalId,
      decision: "approve",
      userId: AUTH_B.userId,
      role: "viewer",
    })
  );

  assert.equal(response.status, 200);
  assert.equal(repository.createTaskCalls, 1);
  assert.equal(repository.tasks.length, 1);
  assert.equal(repository.tasks[0].userId, ADMIN_AUTH.userId);
});

test("expired approvals cannot be approved", async () => {
  const approval = createApprovalRequest({
    requestId: "req_route_test",
    toolName: "create_project_task",
    rawArguments: JSON.stringify({
      projectName: PROJECT_NAME,
      title: "Expired",
    }),
    summary: 'Create task "Expired"',
    details: {},
    ttlMs: -1,
    userId: ADMIN_AUTH.userId,
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 409);
  assert.equal(getApprovalRequest(approval.id)?.status, "expired");
  assert.equal(repository.tasks.length, 0);
});

test("execution failures mark the approval as terminal", async () => {
  const approval = createApprovalRequest({
    requestId: "req_route_test",
    toolName: "create_project_task",
    rawArguments: "{not-json",
    summary: "Invalid approved operation",
    details: {},
    userId: ADMIN_AUTH.userId,
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 500);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "failed");
  assert.equal(getApprovalRequest(approval.id)?.status, "failed");
  assert.equal(repository.tasks.length, 0);

  const replay = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(replay.status, 409);
});

test("missing authorization context is rejected", async () => {
  const approval = createApprovalRequest({
    toolName: "create_project_task",
    rawArguments: JSON.stringify({
      projectName: PROJECT_NAME,
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
