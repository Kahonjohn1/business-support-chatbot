import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  createAutomationWorkflow,
  dispatchAutomationEvent,
  runAutomationNow,
} from "../src/lib/automation/engine.ts";
import {
  AUTH_A,
  FakePersonalRepository,
  installPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";
import {
  installAutomationRepository,
  type FakeAutomationRepository,
} from "./automationRepositoryStub.ts";

let automations: FakeAutomationRepository;
let projects: FakePersonalRepository;

beforeEach(() => {
  automations = installAutomationRepository();
  projects = new FakePersonalRepository();
  installPersonalRepository(projects);
  seedProject(projects, AUTH_A.userId, "Website Redesign", "active");
});

const NOTIFY_WORKFLOW = {
  name: "Notify on demand",
  description: "Manual notification.",
  trigger: { type: "manual" },
  conditions: [],
  actions: [{ type: "notify", message: "Automation completed." }],
};

test("a manual workflow runs a bounded internal action and records success", async () => {
  const workflow = await createAutomationWorkflow(AUTH_A, NOTIFY_WORKFLOW);
  assert.equal(workflow.status, "enabled");

  const execution = await runAutomationNow(AUTH_A, workflow.id);
  assert.equal(execution.status, "succeeded");
  assert.equal(execution.result?.outcomes[0]?.summary, "Automation completed.");
  assert.equal(automations.audits.length >= 2, true);
});

test("an event workflow creates a task in the authenticated workspace", async () => {
  const workflow = await createAutomationWorkflow(AUTH_A, {
    name: "Follow up on new tasks",
    description: "Create a follow-up task when a task is created.",
    trigger: { type: "event", eventType: "task.created" },
    conditions: [],
    actions: [
      {
        type: "create_task",
        title: "Follow up on {{task.title}}",
        projectName: "Website Redesign",
      },
    ],
  });

  await dispatchAutomationEvent(AUTH_A, {
    type: "task.created",
    occurredAt: new Date().toISOString(),
    payload: {
      resourceType: "task",
      task: {
        id: "task-seed",
        title: "Client revision",
        status: "todo",
        priority: "high",
      },
      project: { id: "project-1" },
    },
  });

  assert.equal(projects.createTaskCalls, 1);
  const executions = await automations.listExecutions({
    scope: "personal",
    workspaceId: null,
    userId: AUTH_A.userId,
  });
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.workflowId, workflow.id);
  assert.equal(executions[0]?.status, "succeeded");
});

test("duplicate event delivery is idempotent", async () => {
  await createAutomationWorkflow(AUTH_A, {
    ...NOTIFY_WORKFLOW,
    name: "Notify on new task",
    trigger: { type: "event", eventType: "task.created" },
  });
  const event = {
    type: "task.created" as const,
    occurredAt: "2026-11-23T10:00:00.000Z",
    payload: { resourceType: "task", task: { id: "task-1", title: "A" } },
  };

  await dispatchAutomationEvent(AUTH_A, event);
  await dispatchAutomationEvent(AUTH_A, event);

  const executions = await automations.listExecutions({
    scope: "personal",
    workspaceId: null,
    userId: AUTH_A.userId,
  });
  assert.equal(executions.length, 1);
});

test("viewer cannot create or run automations", async () => {
  const viewer = { ...AUTH_A, role: "viewer" as const };
  await assert.rejects(() => createAutomationWorkflow(viewer, NOTIFY_WORKFLOW), /Role/);
});

test("conditions can skip an execution without running actions", async () => {
  const workflow = await createAutomationWorkflow(AUTH_A, {
    name: "High priority only",
    description: "Manual workflow with a condition.",
    trigger: { type: "manual" },
    conditions: [{ field: "task.priority", operator: "equals", value: "high" }],
    actions: [{ type: "notify", message: "High priority found." }],
  });
  const execution = await runAutomationNow(AUTH_A, workflow.id);
  assert.equal(execution.status, "skipped");
});

test("workflow ownership is enforced by the repository filter", async () => {
  const workflow = await createAutomationWorkflow(AUTH_A, NOTIFY_WORKFLOW);
  const other = await automations.getWorkflow(
    { scope: "personal", workspaceId: null, userId: "user-other" },
    workflow.id
  );
  assert.equal(other, null);
});
