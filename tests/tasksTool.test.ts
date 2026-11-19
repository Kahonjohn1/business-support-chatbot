import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_PROJECT_TASK_TOOL,
  LIST_PROJECT_TASKS_TOOL,
  executeCreateProjectTask,
  executeListProjectTasks,
} from "../src/tools/tasksTool.ts";
import {
  createTask,
  getTasksForProject,
  resetDemoTasks,
} from "../src/tools/taskData.ts";
import {
  clearApprovals,
  getApprovalRequest,
  submitApprovalDecision,
} from "../src/lib/approvalWorkflow.ts";
import { clearAuditLogs } from "../src/lib/auditLog.ts";
import type { ToolExecutionContext } from "../src/tools/registry.ts";

const BASE_ARGS = {
  projectName: "Business Support Chatbot",
  title: "Test approval task",
  description: "Created by the test suite.",
  priority: "high",
  assignee: "QA Team",
};

function createPending(title = BASE_ARGS.title) {
  const args = JSON.stringify({ ...BASE_ARGS, title });
  const result = executeCreateProjectTask(args, { requestId: "req_task_test" });
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");

  const data = result.data as {
    status: string;
    approvalId?: string;
  };
  assert.equal(data.status, "pending_approval");
  assert.equal(typeof data.approvalId, "string");
  assert.ok(data.approvalId);

  return { args, approvalId: data.approvalId as string };
}

beforeEach(() => {
  clearApprovals();
  clearAuditLogs();
  resetDemoTasks();
});

test("task tool schemas ask for project names, not IDs", () => {
  for (const tool of [CREATE_PROJECT_TASK_TOOL, LIST_PROJECT_TASKS_TOOL]) {
    const properties = tool.function.parameters.properties;
    assert.equal("projectName" in properties, true);
    assert.equal("projectId" in properties, false);
  }
});

test("create_project_task prepares an approval without writing a task", () => {
  const { approvalId } = createPending();

  const approval = getApprovalRequest(approvalId);
  assert.equal(approval?.status, "pending");
  assert.equal(approval?.toolName, "create_project_task");
  assert.match(approval?.summary ?? "", /Business Support Chatbot/);
  assert.doesNotMatch(approval?.summary ?? "", /PRJ-/);
  assert.equal(
    (approval?.details as { projectName?: string }).projectName,
    "Business Support Chatbot"
  );
  assert.equal("projectId" in (approval?.details ?? {}), false);
  assert.equal(getTasksForProject("PRJ-104").length, 2);
});

test("model-supplied approvalId arguments are rejected", () => {
  const { approvalId } = createPending();
  const result = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, approvalId }),
    { requestId: "req_task_test" }
  );

  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected model-supplied approvalId to be rejected");
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.match(result.error.message, /unknown argument/i);
  assert.equal(getApprovalRequest(approvalId)?.status, "pending");
});

test("a server-bound approval executes the exact approved task once", () => {
  const { args, approvalId } = createPending();
  submitApprovalDecision(approvalId, "approve", "tester");

  const context: ToolExecutionContext = {
    requestId: "req_task_test",
    approvalId,
  };
  const result = executeCreateProjectTask(args, context);
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected approved execution to succeed");

  const data = result.data as {
    status: string;
    projectName: string;
    task: { title: string; sampleData: true };
  };
  assert.equal(data.status, "executed");
  assert.equal(data.projectName, "Business Support Chatbot");
  assert.equal(data.task.title, BASE_ARGS.title);
  assert.equal(data.task.sampleData, true);
  assert.equal("taskId" in data.task, false);
  assert.equal("projectId" in data.task, false);
  assert.equal(getTasksForProject("PRJ-104").length, 3);

  const replay = executeCreateProjectTask(args, context);
  assert.equal(replay.ok, true);
  if (!replay.ok) assert.fail("Expected idempotent replay to succeed");
  assert.deepEqual(replay.data, data);
  assert.equal(getTasksForProject("PRJ-104").length, 3);
  assert.equal(getApprovalRequest(approvalId)?.status, "executed");
});

test("an approval cannot execute different task details", () => {
  const { args, approvalId } = createPending("Original title");
  submitApprovalDecision(approvalId, "approve", "tester");

  const tampered = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, title: "Tampered title" }),
    { requestId: "req_task_test", approvalId }
  );
  assert.equal(tampered.ok, false);
  if (tampered.ok) assert.fail("Expected mismatched approval to fail");
  assert.equal(tampered.error.code, "INVALID_ARGUMENTS");
  assert.match(tampered.error.message, /does not match/i);
  assert.equal(getApprovalRequest(approvalId)?.status, "approved");
  assert.equal(getTasksForProject("PRJ-104").length, 2);

  const original = executeCreateProjectTask(args, {
    requestId: "req_task_test",
    approvalId,
  });
  assert.equal(original.ok, true);
  if (!original.ok) assert.fail("Expected the original approval to still work");
  assert.equal(getTasksForProject("PRJ-104").length, 3);
});

test("an approval is bound to the request that prepared it", () => {
  const { args, approvalId } = createPending();
  submitApprovalDecision(approvalId, "approve", "tester");

  const result = executeCreateProjectTask(args, {
    requestId: "a-different-request",
    approvalId,
  });
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected a cross-request approval to fail");
  assert.equal(result.error.code, "INVALID_ARGUMENTS");
  assert.match(result.error.message, /not valid for this request/i);
  assert.equal(getApprovalRequest(approvalId)?.status, "approved");
});

test("unknown projects do not create an approval or a task", () => {
  const result = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, projectName: "Mobile App" }),
    { requestId: "req_task_test" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a not-found result");
  const data = result.data as {
    status: string;
    projectName?: string;
    approvalId?: string;
  };
  assert.equal(data.status, "not_found");
  assert.equal(data.projectName, "Mobile App");
  assert.equal(data.approvalId, undefined);
  assert.equal("projectId" in data, false);
  assert.equal(getTasksForProject("PRJ-999").length, 0);
});

test("task argument contracts reject unknown and over-long fields", () => {
  const unknown = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, extra: true }),
    { requestId: "req_task_test" }
  );
  assert.equal(unknown.ok, false);
  if (unknown.ok) assert.fail("Expected unknown arguments to be rejected");
  assert.equal(unknown.error.code, "INVALID_ARGUMENTS");

  const overlong = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, description: "x".repeat(501) }),
    { requestId: "req_task_test" }
  );
  assert.equal(overlong.ok, false);
  if (overlong.ok) assert.fail("Expected an over-long description to be rejected");
  assert.equal(overlong.error.code, "INVALID_ARGUMENTS");
});

test("list_project_tasks validates its contract and returns demo tasks", () => {
  const extra = executeListProjectTasks(
    JSON.stringify({ projectName: "Business Support Chatbot", extra: true })
  );
  assert.equal(extra.ok, false);
  if (extra.ok) assert.fail("Expected unknown arguments to be rejected");
  assert.equal(extra.error.code, "INVALID_ARGUMENTS");

  const result = executeListProjectTasks(
    JSON.stringify({ projectName: "business support chatbot" })
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected task listing to succeed");
  const data = result.data as {
    projectName: string;
    totalTasks: number;
    tasks: Array<Record<string, unknown>>;
  };
  assert.equal(data.projectName, "Business Support Chatbot");
  assert.equal(data.totalTasks, 2);
  assert.equal("projectId" in data, false);
  assert.equal("taskId" in data.tasks[0], false);
  assert.equal("projectId" in data.tasks[0], false);
});

test("list_project_tasks can find a task by title", () => {
  const result = executeListProjectTasks(
    JSON.stringify({
      projectName: "Business Support Chatbot",
      taskName: "approval workflow",
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected task lookup to succeed");
  const data = result.data as {
    status: string;
    totalTasks: number;
    tasks: Array<{ title: string }>;
  };
  assert.equal(data.status, "ok");
  assert.equal(data.totalTasks, 1);
  assert.equal(
    data.tasks[0].title,
    "Implement approval workflow for business tools"
  );
});

test("list_project_tasks asks for clarification when several tasks match", () => {
  createTask({
    projectId: "PRJ-104",
    title: "Approval follow-up review",
    priority: "low",
  });

  const result = executeListProjectTasks(
    JSON.stringify({
      projectName: "Business Support Chatbot",
      taskName: "approval",
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected task lookup to succeed");
  const data = result.data as {
    status: string;
    choices: Array<Record<string, unknown>>;
  };
  assert.equal(data.status, "needs_clarification");
  assert.equal(data.choices.length, 2);
  assert.equal("taskId" in data.choices[0], false);
  assert.equal("projectId" in data.choices[0], false);
});

test("project resolution supports an unambiguous partial name", () => {
  const result = executeCreateProjectTask(
    JSON.stringify({ ...BASE_ARGS, projectName: "chatbot" }),
    { requestId: "req_task_test" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a pending approval result");
  const data = result.data as { status: string; approvalId?: string };
  assert.equal(data.status, "pending_approval");
  assert.equal(typeof data.approvalId, "string");
});
