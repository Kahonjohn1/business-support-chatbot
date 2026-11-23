import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_PROJECT_TASK_TOOL,
  LIST_PROJECT_TASKS_TOOL,
  executeCreateProjectTask,
  executeListProjectTasks,
} from "../src/tools/tasksTool.ts";
import {
  clearApprovals,
  getApprovalRequest,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import type { ToolExecutionContext } from "../src/tools/registry.ts";
import {
  AUTH_A,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";

const BASE_ARGS = {
  projectName: "Website Redesign",
  title: "Test approval task",
  description: "Created by the test suite.",
  priority: "high",
  assignee: "QA Team",
};

let repository: FakePersonalRepository;

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return { requestId: "req_task_test", auth: AUTH_A, ...overrides };
}

async function createPending(title = BASE_ARGS.title) {
  const args = JSON.stringify({ ...BASE_ARGS, title });
  const result = await executeCreateProjectTask(args, context());
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");

  const data = result.data as { status: string; approvalId?: string };
  assert.equal(data.status, "pending_approval");
  assert.equal(typeof data.approvalId, "string");
  assert.ok(data.approvalId);

  return { args, approvalId: data.approvalId as string };
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetPersonalRepository();
  repository = installPersonalRepository(new FakePersonalRepository());
  seedProject(repository, AUTH_A.userId, BASE_ARGS.projectName, "active");
});

test("task tool schemas ask for project names, not IDs or user IDs", () => {
  for (const tool of [CREATE_PROJECT_TASK_TOOL, LIST_PROJECT_TASKS_TOOL]) {
    const properties = tool.function.parameters.properties;
    assert.equal("projectName" in properties, true);
    assert.equal("projectId" in properties, false);
    assert.equal("userId" in properties, false);
  }
});

test("create_project_task prepares an approval without writing a task", async () => {
  const { approvalId } = await createPending();

  const approval = getApprovalRequest(approvalId);
  assert.equal(approval?.status, "pending");
  assert.equal(approval?.toolName, "create_project_task");
  assert.equal(approval?.userId, AUTH_A.userId);
  assert.match(approval?.summary ?? "", /Website Redesign/);
  assert.equal(
    (approval?.details as { projectName?: string }).projectName,
    "Website Redesign"
  );
  assert.equal("projectId" in (approval?.details ?? {}), false);
  assert.equal("resourceId" in (approval?.details ?? {}), false);
  assert.equal(repository.tasks.length, 0);
  assert.equal(repository.createTaskCalls, 0);
});

test("model-supplied approvalId arguments are rejected", async () => {
  const { approvalId } = await createPending();
  const result = await executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, approvalId }),
    context()
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected model-supplied approvalId to be rejected");
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.match(result.error.message, /unknown argument/i);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
});

test("a server-bound approval executes the exact approved task once", async () => {
  const { args, approvalId } = await createPending();
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);

  const executionContext = context({ approvalId });
  const result = await executeCreateProjectTask(args, executionContext);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected approved execution to succeed");

  const data = result.data as {
    status: string;
    projectName: string;
    task: { title: string };
  };
  assert.equal(data.status, "executed");
  assert.equal(data.projectName, "Website Redesign");
  assert.equal(data.task.title, BASE_ARGS.title);
  assert.equal("taskId" in data.task, false);
  assert.equal("projectId" in data.task, false);
  assert.equal(repository.tasks.length, 1);

  const replay = await executeCreateProjectTask(args, executionContext);
  assert.equal(replay.ok, true);
  if (!replay.ok) assert.fail("Expected idempotent replay to succeed");
  assert.deepEqual(replay.data, data);
  assert.equal(repository.tasks.length, 1);
  assert.equal(repository.createTaskCalls, 1);
  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
});

test("an approval cannot execute different task details", async () => {
  const { args, approvalId } = await createPending("Original title");
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);

  const tampered = await executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, title: "Tampered title" }),
    context({ approvalId })
  );
  assert.equal(tampered.ok, false);
  if (tampered.ok) assert.fail("Expected mismatched approval to fail");
  assert.equal(tampered.error.code, "INVALID_ARGUMENTS");
  assert.equal(getApprovalRequest(approvalId)?.status, "approved");
  assert.equal(repository.tasks.length, 0);

  const original = await executeCreateProjectTask(args, context({ approvalId }));
  assert.equal(original.ok, true);
  assert.equal(repository.tasks.length, 1);
});

test("an approval is bound to the request and the authenticated user", async () => {
  const { args, approvalId } = await createPending();
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);

  const wrongRequest = await executeCreateProjectTask(
    args,
    context({ requestId: "a-different-request", approvalId })
  );
  assert.equal(wrongRequest.ok, false);
  if (wrongRequest.ok) assert.fail("Expected cross-request approval to fail");
  assert.equal(wrongRequest.error.code, "INVALID_ARGUMENTS");

  const wrongUser = await executeCreateProjectTask(
    args,
    context({
      approvalId,
      auth: {
        userId: "user-b",
        role: "operator",
        workspaceKind: "personal",
        source: "personal_owner",
        isDemo: false,
      },
    })
  );
  assert.equal(wrongUser.ok, false);
  if (wrongUser.ok) assert.fail("Expected cross-user approval to fail");
  assert.equal(wrongUser.error.code, "PERMISSION_DENIED");
  assert.equal(repository.tasks.length, 0);
});

test("unknown projects do not create an approval or a task", async () => {
  const result = await executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, projectName: "Mobile App" }),
    context()
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a not-found result");
  const data = result.data as { status: string; approvalId?: string };

  assert.equal(data.status, "not_found");
  assert.equal(data.approvalId, undefined);
  assert.equal(repository.tasks.length, 0);
});

test("task argument contracts reject unknown and over-long fields", async () => {
  const unknown = await executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, extra: true }),
    context()
  );
  assert.equal(unknown.ok, false);
  if (unknown.ok) assert.fail("Expected unknown arguments to be rejected");
  assert.equal(unknown.error.code, "INVALID_ARGUMENTS");

  const overlong = await executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, description: "x".repeat(501) }),
    context()
  );
  assert.equal(overlong.ok, false);
  if (overlong.ok) assert.fail("Expected an over-long description to be rejected");
  assert.equal(overlong.error.code, "INVALID_ARGUMENTS");
});

test("task creation never happens without approval execution", async () => {
  const result = await executeCreateProjectTask(
    JSON.stringify(BASE_ARGS),
    context()
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");
  assert.equal((result.data as { status: string }).status, "pending_approval");
  assert.equal(repository.createTaskCalls, 0);
  assert.equal(repository.tasks.length, 0);
});

test("database failure during creation produces no success", async () => {
  const { args, approvalId } = await createPending("DB failure task");
  submitApprovalDecision(approvalId, "approve", AUTH_A.userId);
  repository.failures.add("createTask");

  const result = await executeCreateProjectTask(args, context({ approvalId }));
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Database failure must not report success");
  assert.equal(result.error.code, "EXECUTION_FAILED");
  assert.equal(repository.tasks.length, 0);
  assert.equal(getApprovalRequest(approvalId)?.status, "failed");
});

test("list_project_tasks reads real tasks and supports title lookup", async () => {
  seedProject(repository, AUTH_A.userId, "Marketing Site", "planned");
  const project = repository.projects[0];
  repository.tasks.push({
    id: "task-existing",
    projectId: project.id,
    title: "Approval workflow follow-up",
    description: "Review remaining work.",
    priority: "medium",
    status: "todo",
    assignee: "Unassigned",
    createdAt: new Date().toISOString(),
    userId: AUTH_A.userId,
  });

  const result = await executeListProjectTasks(
    JSON.stringify({ projectName: BASE_ARGS.projectName, taskName: "approval" }),
    context()
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected task listing to succeed");
  const data = result.data as {
    status: string;
    totalTasks: number;
    tasks: Array<Record<string, unknown>>;
  };

  assert.equal(data.status, "ok");
  assert.equal(data.totalTasks, 1);
  assert.equal(data.tasks[0].title, "Approval workflow follow-up");
  assert.equal("taskId" in data.tasks[0], false);
  assert.equal("projectId" in data.tasks[0], false);
  assert.equal("userId" in data.tasks[0], false);
});

test("list_project_tasks fails closed on database errors", async () => {
  repository.failures.add("listTasks");

  const result = await executeListProjectTasks(
    JSON.stringify({ projectName: BASE_ARGS.projectName }),
    context()
  );
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Database failure must not return task data");
  assert.equal(result.error.code, "EXECUTION_FAILED");
});
