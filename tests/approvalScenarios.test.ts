import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handlePersonalApprovalPost } from "../src/app/api/personal/approvals/route.ts";
import { formatApprovalOutcome } from "../src/lib/approvalOutcome.ts";
import {
  clearApprovals,
  createApprovalRequest,
  getApprovalRequest,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import { executeGetProjectStatus } from "../src/tools/projectStatusTool.ts";
import {
  executeCreateProjectTask,
  executeListProjectTasks,
} from "../src/tools/tasksTool.ts";
import {
  AUTH_A,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
  seedTask,
} from "./personalRepositoryStub.ts";

interface ApprovalResponseBody {
  status?: string;
  message?: string;
  result?: unknown;
}

const PROJECT_NAME = "Website Redesign";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/personal/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(request: Request): Promise<Response> {
  return handlePersonalApprovalPost(request, AUTH_A);
}

function postAs(
  auth: typeof AUTH_A | typeof AUTH_B,
  request: Request
): Promise<Response> {
  return handlePersonalApprovalPost(request, auth);
}

async function createPending(title: string): Promise<string> {
  const result = await executeCreateProjectTask(
    JSON.stringify({ projectName: PROJECT_NAME, title }),
    { requestId: "req_scenario_test", auth: AUTH_A }
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
  seedProject(repository, AUTH_A.userId, PROJECT_NAME, "active");
});

test("successful scenario writes a real personal task and reports the outcome", async () => {
  const approvalId = await createPending("Scenario success");

  const response = await post(
    jsonRequest({ approvalId, decision: "approve" })
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "executed");

  const report = formatApprovalOutcome({
    status: "executed",
    approvalId,
    result: body.result,
  });

  assert.match(report, /Scenario success/);
  assert.match(report, /created in project "Website Redesign"/);
  assert.doesNotMatch(report, /PRJ-|TSK-/);
  assert.doesNotMatch(report, /sample demo data/i);
  assert.equal(repository.tasks.length, 1);
  assert.equal(repository.tasks[0].userId, AUTH_A.userId);
  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
});

test("denied scenario writes nothing and reports the rejection", async () => {
  const approvalId = await createPending("Scenario denied");

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
  assert.equal(repository.tasks.length, 0);
});

test("an expired personal approval never executes", async () => {
  const approval = createApprovalRequest({
    requestId: "req_scenario_test",
    toolName: "create_project_task",
    rawArguments: JSON.stringify({ projectName: PROJECT_NAME, title: "Expired task" }),
    summary: "Expired task",
    details: {},
    ttlMs: -1,
    userId: AUTH_A.userId,
    resourceId: repository.projects[0].id,
  });

  const response = await post(
    jsonRequest({ approvalId: approval.id, decision: "approve" })
  );
  assert.equal(response.status, 409);
  assert.equal(getApprovalRequest(approval.id)?.status, "expired");
  assert.equal(repository.tasks.length, 0);
});

test("another user cannot decide or execute an approval", async () => {
  const approvalId = await createPending("Cross-user attempt");

  const response = await postAs(
    AUTH_B,
    jsonRequest({ approvalId, decision: "approve" })
  );

  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
});

test("an approval bound to another user's project cannot execute", async () => {
  const otherProject = seedProject(repository, AUTH_B.userId, PROJECT_NAME);
  const rawArguments = JSON.stringify({
    projectName: PROJECT_NAME,
    title: "Cross-resource attempt",
  });
  const approval = createApprovalRequest({
    requestId: "req_cross_resource",
    toolName: "create_project_task",
    rawArguments,
    summary: "Cross-resource attempt",
    details: {},
    userId: AUTH_B.userId,
    resourceId: repository.projects[0].id,
  });
  submitApprovalDecision(approval.id, "approve", AUTH_B.userId);

  const result = await executeCreateProjectTask(rawArguments, {
    requestId: "req_cross_resource",
    auth: AUTH_B,
    approvalId: approval.id,
  });

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected the cross-resource approval to be rejected");
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.equal(otherProject.userId, AUTH_B.userId);
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
});

test("replaying an executed approval does not create another task", async () => {
  const approvalId = await createPending("Replay task");

  const first = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(first.status, 200);
  assert.equal(repository.createTaskCalls, 1);

  const replay = await post(jsonRequest({ approvalId, decision: "approve" }));
  assert.equal(replay.status, 200);
  const body = (await replay.json()) as ApprovalResponseBody;
  assert.equal(body.status, "executed");
  assert.equal(repository.createTaskCalls, 1);
  assert.equal(repository.tasks.length, 1);
});

test("failed scenario writes nothing and reports the failure", async () => {
  const approval = createApprovalRequest({
    requestId: "req_scenario_test",
    toolName: "create_project_task",
    rawArguments: "{not-json",
    summary: "Scenario failure",
    details: {},
    userId: AUTH_A.userId,
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
  assert.equal(repository.tasks.length, 0);
});

test("a database failure during execution never reports success", async () => {
  const approvalId = await createPending("Database failure task");
  repository.failures.add("createTask");

  const response = await post(
    jsonRequest({ approvalId, decision: "approve" })
  );

  assert.equal(response.status, 500);
  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "failed");
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
  assert.equal(getApprovalRequest(approvalId)?.status, "failed");
});

test("acceptance scenario finds the project, checks status and tasks, then approves a follow-up", async () => {
  const context = { requestId: "req_acceptance", auth: AUTH_A };
  seedTask(repository, AUTH_A.userId, repository.projects[0].id, "Outstanding copy review");

  const statusResult = await executeGetProjectStatus(
    JSON.stringify({ projectName: PROJECT_NAME }),
    context
  );
  assert.equal(statusResult.ok, true);
  if (!statusResult.ok) assert.fail("Expected project status lookup to succeed");
  const statusData = statusResult.data as {
    status: string;
    project: { name: string; status: string };
  };
  assert.equal(statusData.status, "ok");
  assert.equal(statusData.project.name, PROJECT_NAME);
  assert.equal(statusData.project.status, "active");

  const tasksResult = await executeListProjectTasks(
    JSON.stringify({ projectName: PROJECT_NAME }),
    context
  );
  assert.equal(tasksResult.ok, true);
  if (!tasksResult.ok) assert.fail("Expected outstanding task lookup to succeed");
  const tasksData = tasksResult.data as { totalTasks: number };
  assert.equal(tasksData.totalTasks, 1);

  const pendingResult = await executeCreateProjectTask(
    JSON.stringify({
      projectName: PROJECT_NAME,
      title: "Follow up on outstanding copy review",
    }),
    context
  );
  assert.equal(pendingResult.ok, true);
  if (!pendingResult.ok) assert.fail("Expected a pending approval");
  const pendingData = pendingResult.data as { approvalId?: string };
  assert.ok(pendingData.approvalId);
  assert.equal(repository.createTaskCalls, 0);

  const response = await post(
    jsonRequest({ approvalId: pendingData.approvalId, decision: "approve" })
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as ApprovalResponseBody;
  assert.equal(body.status, "executed");
  assert.equal(repository.createTaskCalls, 1);
  assert.equal(repository.tasks.length, 2);
  assert.equal(repository.tasks[1].userId, AUTH_A.userId);
  assert.equal(repository.tasks[1].title, "Follow up on outstanding copy review");
});
