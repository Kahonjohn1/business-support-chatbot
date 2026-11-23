import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleActiveApprovalPost } from "../src/app/api/approvals/active/route.ts";
import {
  handleCreateProject,
} from "../src/app/api/projects/route.ts";
import { handleUpdateProject } from "../src/app/api/projects/[id]/route.ts";
import { handleCreateTask } from "../src/app/api/tasks/route.ts";
import { handleUpdateTask } from "../src/app/api/tasks/[id]/route.ts";
import { clearApprovals } from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import {
  parseUpdateProjectInput,
  parseUpdateTaskInput,
} from "../src/lib/workspace/projectManagementInput.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  resetWorkspaceProjectRepository,
  setWorkspaceProjectRepository,
} from "../src/lib/workspace/workspaceProjectData.ts";
import { executeUpdateProject } from "../src/tools/projectStatusTool.ts";
import { executeUpdateProjectTask } from "../src/tools/tasksTool.ts";
import {
  AUTH_A,
  AUTH_B,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
  seedTask,
} from "./personalRepositoryStub.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  USER_A as WORKSPACE_USER_A,
  WORKSPACE_A,
  sharedAuth,
} from "./workspaceProjectStub.ts";

const PROJECT_NAME = "Website Redesign";

const VIEWER_AUTH = {
  userId: "viewer-user",
  role: "viewer",
  workspaceKind: "personal",
  source: "personal_owner",
  isDemo: false,
} as const;

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/project-management", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let personal: FakePersonalRepository;
let hybrid: FakeHybridWorkspaceRepository;
let projects: FakeWorkspaceProjectRepository;

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetPersonalRepository();
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  personal = installPersonalRepository(new FakePersonalRepository());
  hybrid = new FakeHybridWorkspaceRepository();
  projects = new FakeWorkspaceProjectRepository();
  setHybridWorkspaceRepository(hybrid);
  seedProject(personal, AUTH_A.userId, PROJECT_NAME, "active");
});

test("project management payload parsers validate fields and normalize assignees", () => {
  assert.throws(
    () => parseUpdateProjectInput({}),
    /At least one project field must be provided/
  );
  assert.throws(
    () => parseUpdateTaskInput({ title: 42 }),
    /title must be a string/
  );
  assert.throws(
    () => parseUpdateTaskInput({ priority: "urgent" }),
    /priority must be low, medium, or high/
  );

  const task = parseUpdateTaskInput({
    assignee: "   ",
  });
  assert.equal(task.assignee, "Unassigned");
});

test("project API creates and updates only records in the authenticated scope", async () => {
  const createdResponse = await handleCreateProject(
    jsonRequest({ name: "Launch Plan", progressNotes: "Draft" }),
    AUTH_A
  );
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()) as {
    project: { id: string; name: string };
  };
  assert.equal(created.project.name, "Launch Plan");
  assert.equal(personal.projects[1].userId, AUTH_A.userId);

  const updatedResponse = await handleUpdateProject(
    jsonRequest({ status: "active", blockers: ["Waiting on approval"] }),
    AUTH_A,
    created.project.id
  );
  assert.equal(updatedResponse.status, 200);
  assert.equal(personal.projects[1].status, "active");
  assert.deepEqual(personal.projects[1].blockers, ["Waiting on approval"]);

  const otherUserResponse = await handleUpdateProject(
    jsonRequest({ status: "completed" }),
    AUTH_B,
    created.project.id
  );
  assert.equal(otherUserResponse.status, 404);
  assert.equal(personal.projects[1].status, "active");
});

test("task API creates and updates tasks inside the selected project", async () => {
  const createdResponse = await handleCreateTask(
    jsonRequest({
      projectId: "project-1",
      title: "Draft release notes",
      priority: "high",
      assignee: "",
    }),
    AUTH_A
  );
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()) as {
    task: { id: string; title: string };
  };
  assert.equal(created.task.title, "Draft release notes");
  assert.equal(personal.tasks[0].assignee, "Unassigned");

  const updatedResponse = await handleUpdateTask(
    jsonRequest({ status: "done", assignee: "Ada" }),
    AUTH_A,
    created.task.id
  );
  assert.equal(updatedResponse.status, 200);
  assert.equal(personal.tasks[0].status, "done");
  assert.equal(personal.tasks[0].assignee, "Ada");

  const otherUserResponse = await handleUpdateTask(
    jsonRequest({ title: "Not allowed" }),
    AUTH_B,
    created.task.id
  );
  assert.equal(otherUserResponse.status, 404);
  assert.equal(personal.tasks[0].title, "Draft release notes");
});

test("viewer roles cannot write projects or tasks through the management API", async () => {
  const projectResponse = await handleCreateProject(
    jsonRequest({ name: "Viewer Project" }),
    VIEWER_AUTH
  );
  assert.equal(projectResponse.status, 403);

  const taskResponse = await handleCreateTask(
    jsonRequest({ projectId: "project-1", title: "Viewer Task" }),
    VIEWER_AUTH
  );
  assert.equal(taskResponse.status, 403);
  assert.equal(personal.projects.length, 1);
  assert.equal(personal.tasks.length, 0);
});

test("shared workspace writes stay inside the verified workspace", async () => {
  setWorkspaceProjectRepository(projects);
  const sharedWriteAuth = sharedAuth(WORKSPACE_A, WORKSPACE_USER_A, "staff");
  const createdResponse = await handleCreateProject(
    jsonRequest({ name: "Shared Launch" }),
    sharedWriteAuth
  );
  assert.equal(createdResponse.status, 200);
  const created = (await createdResponse.json()) as {
    project: { id: string };
  };
  assert.equal(projects.projects[0].workspaceId, WORKSPACE_A);

  hybrid.addMembership(WORKSPACE_A, VIEWER_AUTH.userId, "viewer");
  const viewerAuth = sharedAuth(WORKSPACE_A, VIEWER_AUTH.userId, "viewer");
  const deniedResponse = await handleUpdateProject(
    jsonRequest({ status: "completed" }),
    viewerAuth,
    created.project.id
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal(projects.projects[0].status, "planned");
});

test("active approval route executes an approved project update", async () => {
  const pending = await executeUpdateProject(
    JSON.stringify({ projectName: PROJECT_NAME, status: "completed" }),
    { requestId: "req_update_project_route", auth: AUTH_A }
  );
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected a pending project update approval");
  const approvalId = (pending.data as { approvalId?: string }).approvalId;
  assert.ok(approvalId);
  assert.equal(personal.projects[0].status, "active");

  const response = await handleActiveApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_A
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { status?: string };
  assert.equal(body.status, "executed");
  assert.equal(personal.projects[0].status, "completed");
});

test("active approval route executes an approved task update", async () => {
  const task = seedTask(personal, AUTH_A.userId, "project-1", "Owner-only task");
  const pending = await executeUpdateProjectTask(
    JSON.stringify({
      projectName: PROJECT_NAME,
      taskName: task.title,
      status: "done",
      assignee: "Ada",
    }),
    { requestId: "req_update_task_route", auth: AUTH_A }
  );
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected a pending task update approval");
  const approvalId = (pending.data as { approvalId?: string }).approvalId;
  assert.ok(approvalId);
  assert.equal(personal.tasks[0].status, "todo");

  const response = await handleActiveApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_A
  );
  assert.equal(response.status, 200);
  assert.equal(personal.tasks[0].status, "done");
  assert.equal(personal.tasks[0].assignee, "Ada");
});

test("active approval route does not execute approvals for another user", async () => {
  const pending = await executeUpdateProject(
    JSON.stringify({ projectName: PROJECT_NAME, status: "completed" }),
    { requestId: "req_update_project_route_other", auth: AUTH_A }
  );
  assert.equal(pending.ok, true);
  if (!pending.ok) assert.fail("Expected a pending project update approval");
  const approvalId = (pending.data as { approvalId?: string }).approvalId;
  assert.ok(approvalId);

  const response = await handleActiveApprovalPost(
    jsonRequest({ approvalId, decision: "approve" }),
    AUTH_B
  );
  assert.equal(response.status, 404);
  assert.equal(personal.projects[0].status, "active");
});
