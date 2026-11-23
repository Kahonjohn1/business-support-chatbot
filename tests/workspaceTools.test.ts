import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleApprovalPost } from "../src/app/api/approvals/route.ts";
import { handlePersonalApprovalPost } from "../src/app/api/personal/approvals/route.ts";
import {
  clearApprovals,
  getApprovalRequest,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  resetWorkspaceProjectRepository,
  resolveWorkspaceProjectScope,
  setWorkspaceProjectRepository,
} from "../src/lib/workspace/workspaceProjectData.ts";
import {
  executeRegisteredTool as executeBase,
  type ToolExecutionResult,
} from "../src/tools/registry.ts";
import {
  AUTH_A,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
} from "./personalRepositoryStub.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  USER_A,
  USER_B,
  WORKSPACE_A,
  WORKSPACE_B,
  sharedAuth,
} from "./workspaceProjectStub.ts";

let hybrid: FakeHybridWorkspaceRepository;
let projects: FakeWorkspaceProjectRepository;
let personal: FakePersonalRepository;

function execute(
  toolName: string,
  rawArguments: string,
  auth: unknown,
  requestId = "req_workspace_tool_test",
  approvalId?: string
): Promise<ToolExecutionResult> {
  return executeBase(toolName, rawArguments, {
    requestId,
    auth,
    ...(approvalId ? { approvalId } : {}),
  });
}

async function data(result: ToolExecutionResult): Promise<Record<string, unknown>> {
  if (!result.ok) assert.fail(result.error);
  return JSON.parse(result.content) as Record<string, unknown>;
}

function approvalRequest(body: unknown): Request {
  return new Request("http://localhost/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  resetPersonalRepository();
  personal = installPersonalRepository(new FakePersonalRepository());
  hybrid = new FakeHybridWorkspaceRepository();
  projects = new FakeWorkspaceProjectRepository();
  hybrid.addMembership(WORKSPACE_A, USER_B, "viewer");
  setHybridWorkspaceRepository(hybrid);
  setWorkspaceProjectRepository(projects);
});

test("shared project and task reads stay inside the verified workspace", async () => {
  const staff = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const viewer = sharedAuth(WORKSPACE_A, USER_B, "viewer");
  const scope = await resolveWorkspaceProjectScope(staff);
  const project = projects.seedProject(scope, "Shared Roadmap");
  await projects.createTask(scope, { projectId: project.id, title: "Review scope" });

  const listed = await data(
    await execute("list_projects", JSON.stringify({}), viewer)
  );
  const tasks = await data(
    await execute(
      "list_project_tasks",
      JSON.stringify({ projectName: "Shared Roadmap" }),
      viewer
    )
  );

  assert.equal((listed.projects as unknown[]).length, 1);
  assert.equal((tasks.tasks as unknown[]).length, 1);
});

test("shared viewer role cannot write through the tool registry", async () => {
  const viewer = sharedAuth(WORKSPACE_A, USER_B, "viewer");
  const result = await execute(
    "create_project",
    JSON.stringify({ name: "Viewer Project" }),
    viewer
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected viewer write to be denied");
  assert.equal(result.code, "PERMISSION_DENIED");
  assert.equal(projects.projects.length, 0);
});

test("shared staff can create a task after explicit approval", async () => {
  const staff = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const scope = await resolveWorkspaceProjectScope(staff);
  projects.seedProject(scope, "Launch Plan");
  const args = JSON.stringify({
    projectName: "Launch Plan",
    title: "Publish launch notes",
  });

  const pendingResult = await data(
    await execute("create_project_task", args, staff, "req_shared_approval")
  );
  const approvalId = pendingResult.approvalId;
  assert.equal(pendingResult.status, "pending_approval");
  assert.equal(typeof approvalId, "string");
  assert.equal(projects.createTaskCalls, 0);

  const { submitApprovalDecision } = await import("../src/lib/approvalWorkflow.ts");
  submitApprovalDecision(approvalId as string, "approve", USER_A);

  const executed = await data(
    await execute(
      "create_project_task",
      args,
      staff,
      "req_shared_approval",
      approvalId as string
    )
  );

  assert.equal(executed.status, "executed");
  assert.equal(projects.createTaskCalls, 1);
  assert.equal(projects.tasks[0].workspaceId, WORKSPACE_A);
});

test("an approval prepared in one workspace cannot execute in another", async () => {
  const staffA = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const staffB = sharedAuth(WORKSPACE_B, USER_A, "staff");
  const scopeA = await resolveWorkspaceProjectScope(staffA);
  const scopeB = await resolveWorkspaceProjectScope(staffB);
  projects.seedProject(scopeA, "Cross Workspace Plan");
  projects.seedProject(scopeB, "Cross Workspace Plan");
  const args = JSON.stringify({
    projectName: "Cross Workspace Plan",
    title: "Tampered execution",
  });

  const pending = await data(
    await execute("create_project_task", args, staffA, "req_cross_workspace")
  );
  const approvalId = pending.approvalId as string;
  const { submitApprovalDecision } = await import("../src/lib/approvalWorkflow.ts");
  submitApprovalDecision(approvalId, "approve", USER_A);

  const result = await execute(
    "create_project_task",
    args,
    staffB,
    "req_cross_workspace",
    approvalId
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected cross-workspace approval execution to fail");
  assert.equal(result.code, "INVALID_ARGUMENTS");
  assert.equal(projects.createTaskCalls, 0);
});

test("a personal approval cannot execute in a shared workspace", async () => {
  const pending = await data(
    await execute(
      "create_project",
      JSON.stringify({ name: "Personal Only Project" }),
      AUTH_A,
      "req_personal_cross_context"
    )
  );
  const approvalId = pending.approvalId as string;
  assert.equal(getApprovalRequest(approvalId)?.workspaceKind, "personal");
  submitApprovalDecision(approvalId, "approve", USER_A);

  const response = await handleApprovalPost(
    approvalRequest({ approvalId, decision: "approve" }),
    sharedAuth(WORKSPACE_A, USER_A, "staff")
  );

  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approvalId)?.status, "approved");
  assert.equal(personal.projects.length, 0);
  assert.equal(projects.projects.length, 0);
});

test("a shared approval cannot execute through the personal route", async () => {
  const staff = sharedAuth(WORKSPACE_A, USER_A, "staff");
  const scope = await resolveWorkspaceProjectScope(staff);
  projects.seedProject(scope, "Shared Only Plan");
  const pending = await data(
    await execute(
      "create_project_task",
      JSON.stringify({
        projectName: "Shared Only Plan",
        title: "Personal route replay",
      }),
      staff,
      "req_shared_cross_context"
    )
  );
  const approvalId = pending.approvalId as string;
  assert.equal(getApprovalRequest(approvalId)?.workspaceKind, "shared");
  submitApprovalDecision(approvalId, "approve", USER_A);

  const response = await handlePersonalApprovalPost(
    approvalRequest({ approvalId, decision: "approve" }),
    AUTH_A
  );

  assert.equal(response.status, 404);
  assert.equal(getApprovalRequest(approvalId)?.status, "approved");
  assert.equal(projects.createTaskCalls, 0);
});
