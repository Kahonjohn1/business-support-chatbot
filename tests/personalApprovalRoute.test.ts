import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handlePersonalApprovalPost } from "../src/app/api/personal/approvals/route.ts";
import {
  clearApprovals,
  createApprovalRequest,
  getApprovalRequest,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import { executeCreateProject } from "../src/tools/projectStatusTool.ts";
import { executeCreateProjectTask } from "../src/tools/tasksTool.ts";
import {
  AUTH_A,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";

const PROJECT_NAME = "Website Redesign";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/personal/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function prepareTaskApproval() {
  const result = await executeCreateProjectTask(
    JSON.stringify({ projectName: PROJECT_NAME, title: "Owner-only task" }),
    { requestId: "req_personal_route", auth: AUTH_A }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval");
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

test("a personal approval executes only for its owner", async () => {
  const approvalId = await prepareTaskApproval();

  const otherUserResponse = await handlePersonalApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_B
  );
  assert.equal(otherUserResponse.status, 404);
  assert.equal(repository.tasks.length, 0);

  const ownerResponse = await handlePersonalApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_A
  );
  assert.equal(ownerResponse.status, 200);
  const body = (await ownerResponse.json()) as { status?: string };
  assert.equal(body.status, "executed");
  assert.equal(repository.tasks.length, 1);
  assert.equal(repository.tasks[0].userId, AUTH_A.userId);
});

test("a personal approval without an owner binding is not visible", async () => {
  const approval = createApprovalRequest({
    requestId: "req_personal_route",
    toolName: "create_project_task",
    rawArguments: JSON.stringify({
      projectName: PROJECT_NAME,
      title: "No owner",
    }),
    summary: "No owner",
    details: {},
  });

  const response = await handlePersonalApprovalPost(
    jsonRequest({ approvalId: approval.id, decision: "approve" }),
    AUTH_A
  );
  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approval.id)?.status, "pending");
  assert.equal(repository.tasks.length, 0);
});

test("the personal approval route rejects tools outside its allowlist", async () => {
  const approval = createApprovalRequest({
    requestId: "req_personal_route",
    toolName: "list_projects",
    rawArguments: "{}",
    summary: "Read projects",
    details: {},
    userId: AUTH_A.userId,
  });

  const response = await handlePersonalApprovalPost(
    jsonRequest({ approvalId: approval.id, decision: "approve" }),
    AUTH_A
  );
  assert.equal(response.status, 403);
  assert.equal(getApprovalRequest(approval.id)?.status, "pending");
});

test("the personal approval route creates a project for its owner", async () => {
  const rawArguments = JSON.stringify({ name: "Owner Project", status: "planned" });
  const pending = await executeCreateProject(rawArguments, {
    requestId: "req_personal_route_create_project",
    auth: AUTH_A,
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected a pending project approval");
  const approvalId = (pending.data as { approvalId?: string }).approvalId;
  assert.ok(approvalId);

  const response = await handlePersonalApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_A
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status?: string };
  assert.equal(body.status, "executed");
  assert.equal(repository.projects.length, 2);
  assert.equal(repository.projects[1].name, "Owner Project");
  assert.equal(repository.projects[1].userId, AUTH_A.userId);
});

test("the personal approval route requires authentication", async () => {
  const approvalId = await prepareTaskApproval();

  const response = await handlePersonalApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    undefined
  );
  assert.equal(response.status, 401);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
  assert.equal(repository.tasks.length, 0);
});
