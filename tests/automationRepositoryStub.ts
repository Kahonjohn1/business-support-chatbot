import {
  resetAutomationRepository,
  setAutomationRepository,
  type AutomationExecutionCreateInput,
  type AutomationExecutionListOptions,
  type AutomationRepository,
  type AutomationWorkflowSaveInput,
} from "../src/lib/automation/repository.ts";
import type {
  AutomationAuditInput,
  AutomationAuditRecord,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationExecutionStatus,
  AutomationScope,
  AutomationScopeFilter,
  AutomationWorkflowRecord,
  AutomationWorkflowStatus,
} from "../src/lib/automation/types.ts";

function matches(
  record: { scope: AutomationScope; ownerUserId: string; workspaceId: string | null },
  filter: AutomationScopeFilter
): boolean {
  if (record.scope !== filter.scope) return false;
  if (filter.scope === "personal") return record.ownerUserId === filter.userId;
  return record.workspaceId === filter.workspaceId;
}

export class FakeAutomationRepository implements AutomationRepository {
  readonly workflows: AutomationWorkflowRecord[] = [];
  readonly executions: AutomationExecutionRecord[] = [];
  readonly audits: AutomationAuditRecord[] = [];
  private counter = 0;

  private id(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  async listWorkflows(filter: AutomationScopeFilter) {
    return this.workflows.filter((workflow) => matches(workflow, filter));
  }

  async getWorkflow(filter: AutomationScopeFilter, workflowId: string) {
    return (
      this.workflows.find(
        (workflow) => matches(workflow, filter) && workflow.id === workflowId
      ) ?? null
    );
  }

  async saveWorkflow(filter: AutomationScopeFilter, input: AutomationWorkflowSaveInput) {
    const now = new Date().toISOString();
    if (input.id) {
      const existing = await this.getWorkflow(filter, input.id);
      if (!existing) throw new Error("workflow not found");
      const updated: AutomationWorkflowRecord = {
        ...existing,
        ...input.draft,
        status: input.status,
        ownerRole: input.ownerRole,
        nextRunAt: input.nextRunAt ?? null,
        updatedAt: now,
      };
      this.workflows[this.workflows.indexOf(existing)] = updated;
      return updated;
    }
    const record: AutomationWorkflowRecord = {
      ...input.draft,
      id: this.id("workflow"),
      scope: filter.scope,
      ownerUserId: filter.userId,
      workspaceId: filter.workspaceId,
      createdByUserId: filter.userId,
      ownerRole: input.ownerRole,
      status: input.status,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: input.nextRunAt ?? null,
    };
    this.workflows.push(record);
    return record;
  }

  async setWorkflowStatus(
    filter: AutomationScopeFilter,
    workflowId: string,
    status: AutomationWorkflowStatus
  ) {
    const workflow = await this.getWorkflow(filter, workflowId);
    if (!workflow) return null;
    const updated = { ...workflow, status, updatedAt: new Date().toISOString() };
    this.workflows[this.workflows.indexOf(workflow)] = updated;
    return updated;
  }

  async setWorkflowNextRun(
    filter: AutomationScopeFilter,
    workflowId: string,
    nextRunAt: string | null
  ) {
    const workflow = await this.getWorkflow(filter, workflowId);
    if (!workflow) return;
    this.workflows[this.workflows.indexOf(workflow)] = {
      ...workflow,
      nextRunAt,
      updatedAt: new Date().toISOString(),
    };
  }

  async createExecution(
    filter: AutomationScopeFilter,
    input: AutomationExecutionCreateInput
  ) {
    const existing = this.executions.find(
      (execution) =>
        execution.workflowId === input.workflowId &&
        execution.idempotencyKey === input.idempotencyKey
    );
    if (existing) return { execution: existing, created: false };
    const record: AutomationExecutionRecord = {
      id: this.id("execution"),
      workflowId: input.workflowId,
      ownerUserId: filter.userId,
      scope: filter.scope,
      workspaceId: filter.workspaceId,
      triggerType: input.triggerType,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts,
      context: input.context,
      result: null,
      error: null,
      scheduledFor: input.scheduledFor,
      nextAttemptAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.executions.push(record);
    return { execution: record, created: true };
  }

  async claimExecution(filter: AutomationScopeFilter, executionId: string) {
    const execution = this.executions.find(
      (item) => matches(item, filter) && item.id === executionId && item.status === "pending"
    );
    if (!execution) return null;
    if (execution.attempts >= execution.maxAttempts) return null;
    const claimed: AutomationExecutionRecord = {
      ...execution,
      status: "running",
      attempts: execution.attempts + 1,
      startedAt: new Date().toISOString(),
    };
    this.executions[this.executions.indexOf(execution)] = claimed;
    return claimed;
  }

  async completeExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    result: AutomationExecutionResult
  ) {
    const execution = this.executions.find(
      (item) => matches(item, filter) && item.id === executionId
    );
    if (!execution) return;
    this.executions[this.executions.indexOf(execution)] = {
      ...execution,
      status: "succeeded",
      result,
      finishedAt: new Date().toISOString(),
    };
  }

  async failExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    error: string
  ) {
    this.setExecutionStatus(filter, executionId, "failed", error);
  }

  async skipExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    reason: string
  ) {
    this.setExecutionStatus(filter, executionId, "skipped", reason);
  }

  private setExecutionStatus(
    filter: AutomationScopeFilter,
    executionId: string,
    status: AutomationExecutionStatus,
    error: string
  ) {
    const execution = this.executions.find(
      (item) => matches(item, filter) && item.id === executionId
    );
    if (!execution) return;
    this.executions[this.executions.indexOf(execution)] = {
      ...execution,
      status,
      error,
      finishedAt: new Date().toISOString(),
    };
  }

  async listExecutions(
    filter: AutomationScopeFilter,
    options?: AutomationExecutionListOptions
  ) {
    return this.executions
      .filter((execution) => matches(execution, filter))
      .filter((execution) => !options?.workflowId || execution.workflowId === options.workflowId)
      .filter((execution) => !options?.status || execution.status === options.status)
      .slice(0, options?.limit ?? 50);
  }

  async appendAudit(input: AutomationAuditInput) {
    const record: AutomationAuditRecord = {
      id: this.id("audit"),
      workflowId: input.workflowId ?? null,
      ownerUserId: input.actorUserId,
      scope: input.scope,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.action,
      outcome: input.outcome,
      details: input.details ?? {},
      createdAt: new Date().toISOString(),
    };
    this.audits.push(record);
    return record;
  }

  async listAudit(filter: AutomationScopeFilter, limit: number) {
    return this.audits.filter((audit) => matches(audit, filter)).slice(0, limit);
  }
}

export function installAutomationRepository(): FakeAutomationRepository {
  const repository = new FakeAutomationRepository();
  setAutomationRepository(repository);
  return repository;
}

export function resetAutomationRepositoryState(): void {
  resetAutomationRepository();
}
