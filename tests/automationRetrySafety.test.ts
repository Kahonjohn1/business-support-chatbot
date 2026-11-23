import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  computeNextRunAt,
  createAutomationWorkflow,
  dispatchAutomationEvent,
  processDueAutomations,
} from "../src/lib/automation/engine.ts";
import {
  AUTH_A,
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  seedProject,
} from "./personalRepositoryStub.ts";
import {
  installAutomationRepository,
  resetAutomationRepositoryState,
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

function dueSlot(): string {
  const slot = new Date(Date.now() - 24 * 60 * 60 * 1000);
  slot.setUTCHours(9, 0, 0, 0);
  return slot.toISOString();
}

test("event retries resume without repeating completed actions", async () => {
  projects.failures.add("listTasks");
  const workflow = await createAutomationWorkflow(AUTH_A, {
    name: "Follow up with a status check",
    description: "Create a task then verify task state.",
    trigger: { type: "event", eventType: "task.created" },
    conditions: [],
    actions: [
      { type: "create_task", title: "Follow up", projectName: "Website Redesign" },
      { type: "status_check", resource: "task", name: "Anything" },
    ],
    maxAttempts: 2,
    retryDelaySeconds: 60,
  });

  const dispatched = await dispatchAutomationEvent(AUTH_A, {
    type: "task.created",
    occurredAt: new Date().toISOString(),
    payload: { id: "task-1", title: "Kickoff", projectId: "project-1" },
  });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.status, "failed");
  assert.equal(dispatched[0]?.result?.outcomes.length, 1);
  assert.equal(dispatched[0]?.result?.outcomes[0]?.ok, true);
  assert.equal(projects.createTaskCalls, 1);

  const retry = automations.executions.find((execution) =>
    execution.idempotencyKey.includes(":retry:1")
  );
  assert.ok(retry);
  assert.equal(retry.status, "pending");
  assert.equal(retry.workflowId, workflow.id);

  projects.failures.delete("listTasks");
  automations.executions[automations.executions.indexOf(retry)] = {
    ...retry,
    scheduledFor: new Date(Date.now() - 1000).toISOString(),
  };
  const due = await processDueAutomations(AUTH_A);
  const retried = due.find((execution) => execution.id === retry.id);
  assert.equal(retried?.status, "succeeded");
  assert.equal(retried?.result?.outcomes.length, 2);
  assert.equal(projects.createTaskCalls, 1);
});

test("failures with maxAttempts of one never schedule retries", async () => {
  projects.failures.add("listTasks");
  await createAutomationWorkflow(AUTH_A, {
    name: "Single attempt",
    description: "No retries allowed.",
    trigger: { type: "event", eventType: "task.created" },
    conditions: [],
    actions: [{ type: "status_check", resource: "task", name: "Anything" }],
    maxAttempts: 1,
    retryDelaySeconds: 0,
  });
  const dispatched = await dispatchAutomationEvent(AUTH_A, {
    type: "task.created",
    occurredAt: new Date().toISOString(),
    payload: { id: "task-2", title: "Kickoff", projectId: "project-1" },
  });
  assert.equal(dispatched[0]?.status, "failed");
  assert.equal(
    automations.executions.filter((execution) => execution.idempotencyKey.includes(":retry:"))
      .length,
    0
  );
});

test("due processing advances the schedule once and isolates failures", async () => {
  const scheduledFor = dueSlot();
  const healthy = await createAutomationWorkflow(AUTH_A, {
    name: "Daily notification",
    description: "Notify every morning.",
    trigger: { type: "schedule", interval: "daily", time: "09:00" },
    conditions: [],
    actions: [{ type: "notify", message: "Good morning." }],
  });
  projects.failures.add("getProjectsByName");
  const broken = await createAutomationWorkflow(AUTH_A, {
    name: "Daily task creation",
    description: "Create a task every morning.",
    trigger: { type: "schedule", interval: "daily", time: "09:00" },
    conditions: [],
    actions: [
      { type: "create_task", title: "Daily task", projectName: "Website Redesign" },
    ],
  });
  await automations.setWorkflowNextRun(
    { scope: "personal", userId: AUTH_A.userId, workspaceId: null },
    healthy.id,
    scheduledFor
  );
  await automations.setWorkflowNextRun(
    { scope: "personal", userId: AUTH_A.userId, workspaceId: null },
    broken.id,
    scheduledFor
  );

  const results = await processDueAutomations(AUTH_A);
  assert.equal(results.length, 2);
  const succeeded = results.find((execution) => execution.workflowId === healthy.id);
  const failed = results.find((execution) => execution.workflowId === broken.id);
  assert.equal(succeeded?.status, "succeeded");
  assert.equal(failed?.status, "failed");

  const expectedNext = computeNextRunAt(
    { type: "schedule", interval: "daily", time: "09:00" },
    new Date(),
    scheduledFor
  );
  for (const workflow of automations.workflows) {
    assert.equal(workflow.nextRunAt, expectedNext);
  }

  const again = await processDueAutomations(AUTH_A);
  assert.equal(again.length, 0);
  assert.equal(automations.executions.length, 2);
});

test("duplicate due ticks never re-run a completed slot", async () => {
  const scheduledFor = dueSlot();
  const workflow = await createAutomationWorkflow(AUTH_A, {
    name: "Daily task",
    description: "Create one task per slot.",
    trigger: { type: "schedule", interval: "daily", time: "09:00" },
    conditions: [],
    actions: [
      { type: "create_task", title: "Daily task", projectName: "Website Redesign" },
    ],
  });
  const filter = { scope: "personal", userId: AUTH_A.userId, workspaceId: null } as const;
  await automations.setWorkflowNextRun(filter, workflow.id, scheduledFor);
  await processDueAutomations(AUTH_A);
  assert.equal(projects.createTaskCalls, 1);

  await automations.setWorkflowNextRun(filter, workflow.id, scheduledFor);
  const repeated = await processDueAutomations(AUTH_A);
  assert.equal(repeated.length, 0);
  assert.equal(projects.createTaskCalls, 1);
  assert.equal(automations.executions.length, 1);
});

afterEach(() => {
  resetAutomationRepositoryState();
  resetPersonalRepository();
});
