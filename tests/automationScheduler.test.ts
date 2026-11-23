import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { handleRunDuePost } from "../src/app/api/automations/run-due/route.ts";
import { processScheduledAutomations } from "../src/lib/automation/scheduler.ts";
import {
  resetHybridWorkspaceRepository,
  setHybridWorkspaceRepository,
} from "../src/lib/workspace/hybridWorkspaceData.ts";
import {
  resetWorkspaceProjectRepository,
  setWorkspaceProjectRepository,
} from "../src/lib/workspace/workspaceProjectData.ts";
import {
  FakePersonalRepository,
  installPersonalRepository,
  resetPersonalRepository,
  USER_A,
  USER_B,
} from "./personalRepositoryStub.ts";
import {
  FakeHybridWorkspaceRepository,
  FakeWorkspaceProjectRepository,
  membershipRecord,
  WORKSPACE_A,
  workspaceRecord,
} from "./workspaceProjectStub.ts";
import {
  installAutomationSchedulerRepository,
  resetAutomationSchedulerRepositoryState,
  SCHEDULER_SECRET,
  seedSchedulerWorkflow,
  type FakeAutomationSchedulerRepository,
} from "./automationSchedulerStub.ts";

let scheduler: FakeAutomationSchedulerRepository;
let personal: FakePersonalRepository;
let hybrid: FakeHybridWorkspaceRepository;
let workspaceProjects: FakeWorkspaceProjectRepository;
let originalSecret: string | undefined;

function dueSlot(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

function schedulerRequest(secret?: string): Request {
  return new Request("http://localhost/api/automations/run-due", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-scheduler-secret": secret },
  });
}

beforeEach(() => {
  originalSecret = process.env.AUTOMATION_SCHEDULER_SECRET;
  process.env.AUTOMATION_SCHEDULER_SECRET = SCHEDULER_SECRET;
  scheduler = installAutomationSchedulerRepository();
  personal = new FakePersonalRepository();
  installPersonalRepository(personal);
  hybrid = new FakeHybridWorkspaceRepository();
  setHybridWorkspaceRepository(hybrid);
  workspaceProjects = new FakeWorkspaceProjectRepository();
  setWorkspaceProjectRepository(workspaceProjects);
  workspaceProjects.seedProject({ kind: "personal", userId: USER_A }, "Website Redesign");
  workspaceProjects.seedProject({ kind: "personal", userId: USER_B }, "Website Redesign");
  workspaceProjects.seedProject(
    {
      kind: "shared",
      userId: USER_A,
      workspaceId: WORKSPACE_A,
      workspace: workspaceRecord(WORKSPACE_A),
      membership: membershipRecord(WORKSPACE_A, USER_A, "staff"),
    },
    "Shared Project"
  );
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.AUTOMATION_SCHEDULER_SECRET;
  } else {
    process.env.AUTOMATION_SCHEDULER_SECRET = originalSecret;
  }
  resetAutomationSchedulerRepositoryState();
  resetHybridWorkspaceRepository();
  resetWorkspaceProjectRepository();
  resetPersonalRepository();
});

test("missing scheduler configuration is rejected without leaking details", async () => {
  delete process.env.AUTOMATION_SCHEDULER_SECRET;
  const response = await handleRunDuePost(schedulerRequest(SCHEDULER_SECRET));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(!body.includes(SCHEDULER_SECRET));
});

test("a short configured secret is rejected as unconfigured", async () => {
  process.env.AUTOMATION_SCHEDULER_SECRET = "too-short";
  const response = await handleRunDuePost(schedulerRequest("too-short"));
  assert.equal(response.status, 503);
});

test("missing scheduler secret header is rejected", async () => {
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  const response = await handleRunDuePost(schedulerRequest());
  assert.equal(response.status, 401);
  assert.equal(scheduler.executions.length, 0);
});

test("invalid scheduler secret header is rejected", async () => {
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  const response = await handleRunDuePost(
    schedulerRequest("wrong-secret-0123456789abcdef0123456789abcdef")
  );
  assert.equal(response.status, 401);
  assert.equal(scheduler.executions.length, 0);
});

test("a user session cookie never authorizes the scheduler", async () => {
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  const request = new Request("http://localhost/api/automations/run-due", {
    method: "POST",
    headers: { cookie: "sb-access-token=user-session; sb-refresh-token=refresh" },
  });
  const response = await handleRunDuePost(request);
  assert.equal(response.status, 401);
  assert.equal(scheduler.executions.length, 0);
});

test("authorized scheduler invocation processes due workflows", async () => {
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  const response = await handleRunDuePost(schedulerRequest(SCHEDULER_SECRET));
  assert.equal(response.status, 200);
  const text = await response.text();
  const body = JSON.parse(text) as { processed: number };
  assert.equal(body.processed, 1);
  assert.equal(scheduler.executions[0]?.status, "succeeded");
  assert.ok(!text.includes(SCHEDULER_SECRET));
});

test("the scheduler scans personal and shared workflows globally", async () => {
  seedSchedulerWorkflow(scheduler, {
    ownerUserId: USER_A,
    createdByUserId: USER_A,
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Personal follow-up", projectName: "Website Redesign" },
    ],
  });
  seedSchedulerWorkflow(scheduler, {
    ownerUserId: USER_B,
    createdByUserId: USER_B,
    nextRunAt: dueSlot(),
  });
  seedSchedulerWorkflow(scheduler, {
    scope: "workspace",
    workspaceId: WORKSPACE_A,
    ownerUserId: USER_A,
    createdByUserId: USER_A,
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Shared follow-up", projectName: "Shared Project" },
    ],
  });

  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions.length, 3);
  assert.ok(executions.every((execution) => execution.status === "succeeded"));
  const personalTasks = workspaceProjects.tasks.filter((task) => task.workspaceId === null);
  assert.equal(personalTasks.length, 1);
  assert.equal(personalTasks[0]?.userId, USER_A);
  const sharedTasks = workspaceProjects.tasks.filter((task) => task.workspaceId === WORKSPACE_A);
  assert.equal(sharedTasks.length, 1);
});

test("a revoked workspace membership fails closed without touching data", async () => {
  hybrid.removeMember(USER_A, WORKSPACE_A, USER_A);
  seedSchedulerWorkflow(scheduler, {
    scope: "workspace",
    workspaceId: WORKSPACE_A,
    ownerUserId: USER_A,
    createdByUserId: USER_A,
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Shared follow-up", projectName: "Shared Project" },
    ],
  });
  seedSchedulerWorkflow(scheduler, { ownerUserId: USER_B, createdByUserId: USER_B, nextRunAt: dueSlot() });

  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions.length, 2);
  const failed = executions.find((execution) => execution.scope === "workspace");
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /workspace access/i);
  const succeeded = executions.find((execution) => execution.scope === "personal");
  assert.equal(succeeded?.status, "succeeded");
  assert.equal(workspaceProjects.tasks.length, 0);
});

test("personal workflows execute only under their owner's identity", async () => {
  seedSchedulerWorkflow(scheduler, {
    ownerUserId: USER_B,
    createdByUserId: USER_B,
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Cross-user attempt", projectId: "project-1" },
    ],
  });
  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.result?.outcomes[0]?.ok, false);
  assert.equal(workspaceProjects.tasks.length, 0);
});

test("a viewer-owned workflow cannot perform write actions", async () => {
  seedSchedulerWorkflow(scheduler, {
    ownerRole: "viewer",
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Denied task", projectName: "Website Redesign" },
    ],
  });
  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions[0]?.status, "failed");
  assert.match(executions[0]?.error ?? "", /Role/);
  assert.equal(workspaceProjects.tasks.length, 0);
});

test("concurrent scheduler batches claim each slot exactly once", async () => {
  seedSchedulerWorkflow(scheduler, {
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Once only", projectName: "Website Redesign" },
    ],
  });
  const [first, second] = await Promise.all([
    processScheduledAutomations(SCHEDULER_SECRET),
    processScheduledAutomations(SCHEDULER_SECRET),
  ]);
  const reported = [...first, ...second];
  assert.equal(new Set(reported.map((execution) => execution.id)).size, 1);
  assert.equal(scheduler.executions.length, 1);
  assert.equal(workspaceProjects.createTaskCalls, 1);
});

test("a repeated tick after success does not re-run the slot", async () => {
  const workflow = seedSchedulerWorkflow(scheduler, {
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Once only", projectName: "Website Redesign" },
    ],
  });
  await processScheduledAutomations(SCHEDULER_SECRET);
  const advanced = scheduler.workflows[0]?.nextRunAt;
  assert.ok(advanced && Date.parse(advanced) > Date.parse(workflow.nextRunAt as string));

  scheduler.workflows[0] = { ...scheduler.workflows[0], nextRunAt: workflow.nextRunAt };
  const again = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(again.length, 1);
  assert.equal(again[0]?.status, "succeeded");
  assert.equal(scheduler.executions.length, 1);
  assert.equal(workspaceProjects.createTaskCalls, 1);
});

test("retries resume after the last completed action without duplicating it", async () => {
  workspaceProjects.failures.add("listTasks");
  seedSchedulerWorkflow(scheduler, {
    nextRunAt: dueSlot(),
    maxAttempts: 2,
    retryDelaySeconds: 60,
    actions: [
      { type: "create_task", title: "Durable task", projectName: "Website Redesign" },
      { type: "status_check", resource: "task", taskTitle: "Anything" },
    ],
  });

  const firstBatch = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(firstBatch[0]?.status, "failed");
  assert.equal(firstBatch[0]?.result?.outcomes.length, 1);
  assert.equal(firstBatch[0]?.result?.outcomes[0]?.ok, true);
  assert.equal(workspaceProjects.createTaskCalls, 1);
  const retry = scheduler.executions.find((execution) =>
    execution.idempotencyKey.includes(":retry:1")
  );
  assert.ok(retry);
  assert.equal(retry.status, "pending");

  workspaceProjects.failures.delete("listTasks");
  scheduler.executions[scheduler.executions.indexOf(retry)] = {
    ...retry,
    scheduledFor: dueSlot(),
  };
  const secondBatch = await processScheduledAutomations(SCHEDULER_SECRET);
  const retried = secondBatch.find((execution) => execution.id === retry.id);
  assert.equal(retried?.status, "succeeded");
  assert.equal(retried?.result?.outcomes.length, 2);
  assert.equal(workspaceProjects.createTaskCalls, 1);
});

test("one failing workflow does not stop the scheduler batch", async () => {
  const broken = seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  scheduler.failClaimsFor.add(broken.id);
  seedSchedulerWorkflow(scheduler, { ownerUserId: USER_B, createdByUserId: USER_B, nextRunAt: dueSlot() });

  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.ownerUserId, USER_B);
  assert.equal(executions[0]?.status, "succeeded");
});

test("nextRunAt advances from the scheduled slot even when execution fails", async () => {
  workspaceProjects.failures.add("getProjectsByName");
  const workflow = seedSchedulerWorkflow(scheduler, {
    nextRunAt: dueSlot(),
    actions: [
      { type: "create_task", title: "Failing task", projectName: "Website Redesign" },
    ],
  });
  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions[0]?.status, "failed");
  const next = scheduler.workflows[0]?.nextRunAt;
  assert.ok(next);
  assert.ok(Date.parse(next) > Date.parse(workflow.nextRunAt as string));
  assert.ok(next.endsWith("T09:00:00.000Z"));
});

test("paused, disabled, event, and manual workflows are never scheduled", async () => {
  seedSchedulerWorkflow(scheduler, { status: "paused", nextRunAt: dueSlot() });
  seedSchedulerWorkflow(scheduler, { status: "disabled", nextRunAt: dueSlot() });
  seedSchedulerWorkflow(scheduler, {
    trigger: { type: "event", eventType: "task.created" },
    nextRunAt: dueSlot(),
  });
  seedSchedulerWorkflow(scheduler, { trigger: { type: "manual" }, nextRunAt: dueSlot() });
  const executions = await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(executions.length, 0);
  assert.equal(scheduler.workflows.length, 4);
});

test("the scheduler never creates, enables, or self-approves workflows", async () => {
  const paused = seedSchedulerWorkflow(scheduler, { status: "paused", nextRunAt: dueSlot() });
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  await processScheduledAutomations(SCHEDULER_SECRET);
  assert.equal(scheduler.workflows.length, 2);
  const stillPaused = scheduler.workflows.find((workflow) => workflow.id === paused.id);
  assert.equal(stillPaused?.status, "paused");
  assert.ok(scheduler.audits.every((entry) => entry.action.startsWith("automation.execution.")));
});

test("scheduler audit events are attributed to the workflow owner", async () => {
  seedSchedulerWorkflow(scheduler, {
    scope: "workspace",
    workspaceId: WORKSPACE_A,
    ownerUserId: USER_A,
    createdByUserId: USER_A,
    nextRunAt: dueSlot(),
  });
  await processScheduledAutomations(SCHEDULER_SECRET);
  assert.ok(scheduler.audits.length >= 2);
  assert.ok(scheduler.audits.every((entry) => entry.actorUserId === USER_A));
  assert.ok(scheduler.audits.every((entry) => entry.workspaceId === WORKSPACE_A));
});

test("an invalid secret never reaches scheduler storage operations", async () => {
  seedSchedulerWorkflow(scheduler, { nextRunAt: dueSlot() });
  await assert.rejects(
    () => processScheduledAutomations("wrong-secret-0123456789abcdef0123456789abcdef"),
    /Unauthorized scheduler request/
  );
  assert.equal(scheduler.executions.length, 0);
});
