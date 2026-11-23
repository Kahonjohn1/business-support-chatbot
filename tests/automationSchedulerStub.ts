import {
  resetAutomationSchedulerRepository,
  setAutomationSchedulerRepository,
  type AutomationSchedulerAuditInput,
  type AutomationSchedulerClaim,
  type AutomationSchedulerRepository,
  type AutomationSchedulerRetry,
} from "../src/lib/automation/schedulerRepository.ts";
import type {
  AutomationAuditRecord,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationWorkflowRecord,
} from "../src/lib/automation/types.ts";

export const SCHEDULER_SECRET = "scheduler-secret-0123456789abcdef0123456789abcdef";

export class FakeAutomationSchedulerRepository implements AutomationSchedulerRepository {
  readonly workflows: AutomationWorkflowRecord[] = [];
  readonly executions: AutomationExecutionRecord[] = [];
  readonly audits: AutomationAuditRecord[] = [];
  readonly failClaimsFor = new Set<string>();
  expectedSecret = SCHEDULER_SECRET;
  private counter = 0;

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private authorize(secret: string): void {
    if (secret !== this.expectedSecret) {
      throw new Error("Unauthorized scheduler request.");
    }
  }

  private workflowById(workflowId: string): AutomationWorkflowRecord | undefined {
    return this.workflows.find((workflow) => workflow.id === workflowId);
  }

  private executionById(executionId: string): AutomationExecutionRecord | undefined {
    return this.executions.find((execution) => execution.id === executionId);
  }

  private replaceExecution(updated: AutomationExecutionRecord): void {
    const index = this.executions.findIndex((item) => item.id === updated.id);
    if (index >= 0) this.executions[index] = updated;
  }

  private dueWorkflow(workflow: AutomationWorkflowRecord): boolean {
    return (
      workflow.status === "enabled" &&
      workflow.trigger.type === "schedule" &&
      Boolean(workflow.nextRunAt) &&
      Date.parse(workflow.nextRunAt as string) <= Date.now()
    );
  }

  async listDueWorkflows(secret: string, limit?: number) {
    this.authorize(secret);
    return this.workflows
      .filter((workflow) => this.dueWorkflow(workflow))
      .slice(0, limit ?? 100);
  }

  async getWorkflow(secret: string, workflowId: string) {
    this.authorize(secret);
    return this.workflowById(workflowId) ?? null;
  }

  async claimDueWorkflow(
    secret: string,
    workflowId: string,
    context: Record<string, unknown>,
    nextRunAt: string
  ): Promise<AutomationSchedulerClaim> {
    this.authorize(secret);
    if (this.failClaimsFor.has(workflowId)) {
      throw new Error("simulated claim failure");
    }
    const workflow = this.workflowById(workflowId);
    if (!workflow || !this.dueWorkflow(workflow)) {
      return { claimed: false, created: false, execution: null };
    }
    const scheduledFor = workflow.nextRunAt as string;
    if (Date.parse(nextRunAt) <= Date.parse(scheduledFor)) {
      throw new Error("Next run must be after the scheduled slot.");
    }
    const key = `schedule:${workflow.id}:${scheduledFor}`;
    let execution = this.executions.find(
      (item) => item.workflowId === workflow.id && item.idempotencyKey === key
    );
    let created = false;
    if (!execution) {
      created = true;
      execution = {
        id: this.id("execution"),
        workflowId: workflow.id,
        ownerUserId: workflow.ownerUserId,
        scope: workflow.scope,
        workspaceId: workflow.workspaceId,
        triggerType: "schedule",
        eventType: null,
        idempotencyKey: key,
        status: "pending",
        attempts: 0,
        maxAttempts: workflow.maxAttempts,
        context,
        result: null,
        error: null,
        scheduledFor,
        nextAttemptAt: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.executions.push(execution);
    }
    this.workflows[this.workflows.indexOf(workflow)] = {
      ...workflow,
      nextRunAt,
      updatedAt: new Date().toISOString(),
    };
    return { claimed: true, created, execution };
  }

  async listDueExecutions(secret: string, limit?: number) {
    this.authorize(secret);
    return this.executions
      .filter(
        (execution) =>
          execution.status === "pending" &&
          execution.attempts < execution.maxAttempts &&
          Date.parse(execution.scheduledFor) <= Date.now()
      )
      .slice(0, limit ?? 100);
  }

  async getExecution(secret: string, executionId: string) {
    this.authorize(secret);
    return this.executionById(executionId) ?? null;
  }

  async claimExecution(secret: string, executionId: string) {
    this.authorize(secret);
    const execution = this.executionById(executionId);
    if (
      !execution ||
      execution.status !== "pending" ||
      execution.attempts >= execution.maxAttempts
    ) {
      return null;
    }
    const claimed: AutomationExecutionRecord = {
      ...execution,
      status: "running",
      attempts: execution.attempts + 1,
      startedAt: new Date().toISOString(),
    };
    this.replaceExecution(claimed);
    return claimed;
  }

  async completeExecution(
    secret: string,
    executionId: string,
    result: AutomationExecutionResult
  ) {
    this.authorize(secret);
    const execution = this.executionById(executionId);
    if (!execution || execution.status !== "running") return;
    this.replaceExecution({
      ...execution,
      status: "succeeded",
      result,
      error: null,
      finishedAt: new Date().toISOString(),
    });
    const workflow = this.workflowById(execution.workflowId);
    if (workflow) {
      this.workflows[this.workflows.indexOf(workflow)] = {
        ...workflow,
        lastRunAt: new Date().toISOString(),
      };
    }
  }

  async failExecution(
    secret: string,
    executionId: string,
    error: string,
    result?: AutomationExecutionResult | null
  ) {
    this.authorize(secret);
    const execution = this.executionById(executionId);
    if (!execution || execution.status !== "running") return;
    this.replaceExecution({
      ...execution,
      status: "failed",
      error,
      result: result ?? execution.result,
      finishedAt: new Date().toISOString(),
    });
  }

  async skipExecution(secret: string, executionId: string, reason: string) {
    this.authorize(secret);
    const execution = this.executionById(executionId);
    if (!execution || execution.status !== "running") return;
    this.replaceExecution({
      ...execution,
      status: "skipped",
      error: reason,
      finishedAt: new Date().toISOString(),
    });
  }

  async scheduleRetry(
    secret: string,
    executionId: string,
    context: Record<string, unknown>,
    scheduledFor: string,
    retryNumber: number
  ): Promise<AutomationSchedulerRetry> {
    this.authorize(secret);
    const execution = this.executionById(executionId);
    if (!execution || execution.status !== "failed") {
      return { created: false, execution: null };
    }
    if (retryNumber < 1 || retryNumber >= execution.maxAttempts) {
      throw new Error("Retry number is out of bounds.");
    }
    const key = `${execution.idempotencyKey}:retry:${retryNumber}`;
    const existing = this.executions.find(
      (item) => item.workflowId === execution.workflowId && item.idempotencyKey === key
    );
    if (existing) return { created: false, execution: existing };
    const retry: AutomationExecutionRecord = {
      id: this.id("execution"),
      workflowId: execution.workflowId,
      ownerUserId: execution.ownerUserId,
      scope: execution.scope,
      workspaceId: execution.workspaceId,
      triggerType: execution.triggerType,
      eventType: execution.eventType,
      idempotencyKey: key,
      status: "pending",
      attempts: 0,
      maxAttempts: execution.maxAttempts,
      context,
      result: null,
      error: null,
      scheduledFor,
      nextAttemptAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.executions.push(retry);
    return { created: true, execution: retry };
  }

  async appendAudit(secret: string, input: AutomationSchedulerAuditInput) {
    this.authorize(secret);
    const workflow = this.workflowById(input.workflowId);
    if (!workflow) throw new Error("Workflow was not found.");
    const record: AutomationAuditRecord = {
      id: this.id("audit"),
      workflowId: workflow.id,
      ownerUserId: workflow.ownerUserId,
      scope: workflow.scope,
      workspaceId: workflow.workspaceId,
      actorUserId: workflow.ownerUserId,
      action: input.action,
      outcome: input.outcome,
      details: input.details ?? {},
      createdAt: new Date().toISOString(),
    };
    this.audits.push(record);
    return record;
  }
}

export function seedSchedulerWorkflow(
  repository: FakeAutomationSchedulerRepository,
  overrides: Partial<AutomationWorkflowRecord> = {}
): AutomationWorkflowRecord {
  const now = new Date().toISOString();
  const workflow: AutomationWorkflowRecord = {
    id: `workflow-${repository.workflows.length + 1}`,
    name: "Scheduled workflow",
    description: "",
    trigger: { type: "schedule", interval: "daily", time: "09:00" },
    conditions: [],
    actions: [{ type: "notify", message: "Scheduled run." }],
    maxActions: 5,
    maxAttempts: 1,
    retryDelaySeconds: 0,
    scope: "personal",
    ownerUserId: "user-a",
    workspaceId: null,
    createdByUserId: "user-a",
    ownerRole: "operator",
    status: "enabled",
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: "2026-11-23T09:00:00.000Z",
    ...overrides,
  };
  repository.workflows.push(workflow);
  return workflow;
}

export function installAutomationSchedulerRepository(): FakeAutomationSchedulerRepository {
  const repository = new FakeAutomationSchedulerRepository();
  setAutomationSchedulerRepository(repository);
  return repository;
}

export function resetAutomationSchedulerRepositoryState(): void {
  resetAutomationSchedulerRepository();
}
