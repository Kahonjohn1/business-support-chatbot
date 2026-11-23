import { AutomationError } from "@/lib/automation/errors";
import { authorizationForWorkflow } from "@/lib/automation/context";
import {
  computeNextRunAt,
  executeAction,
  matchesConditions,
  resumeOutcomesFromContext,
  sanitizeContext,
  summaryFromOutcomes,
} from "@/lib/automation/engine";
import {
  getAutomationSchedulerRepository,
  type AutomationSchedulerRepository,
} from "@/lib/automation/schedulerRepository";
import type {
  AutomationActionOutcome,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationWorkflowRecord,
} from "@/lib/automation/types";

const MAX_DUE_BATCH = 100;

async function audit(
  repository: AutomationSchedulerRepository,
  secret: string,
  workflowId: string,
  action: string,
  outcome: "success" | "failure" | "denied" | "pending",
  details: Record<string, unknown>
): Promise<void> {
  try {
    await repository.appendAudit(secret, {
      workflowId,
      action,
      outcome,
      details: sanitizeContext(details),
    });
  } catch {
    return;
  }
}

async function runScheduledExecution(
  repository: AutomationSchedulerRepository,
  secret: string,
  execution: AutomationExecutionRecord
): Promise<AutomationExecutionRecord> {
  const claimed = await repository.claimExecution(secret, execution.id);
  if (!claimed) {
    return (await repository.getExecution(secret, execution.id)) ?? execution;
  }

  const workflow = await repository.getWorkflow(secret, claimed.workflowId);
  if (!workflow) {
    await repository.failExecution(secret, claimed.id, "Workflow no longer exists.");
    return (await repository.getExecution(secret, claimed.id)) ?? claimed;
  }

  const executionContext = sanitizeContext(claimed.context);
  if (!matchesConditions(workflow.conditions, executionContext)) {
    await repository.skipExecution(secret, claimed.id, "Conditions did not match.");
    await audit(repository, secret, workflow.id, "automation.execution.skipped", "success", {
      workflowId: workflow.id,
      executionId: claimed.id,
    });
    return (await repository.getExecution(secret, claimed.id)) ?? claimed;
  }

  const outcomes: AutomationActionOutcome[] = resumeOutcomesFromContext(claimed.context);
  let summary = summaryFromOutcomes(outcomes);
  try {
    const ownerAuth = await authorizationForWorkflow(workflow);
    for (const action of workflow.actions.slice(outcomes.length, workflow.maxActions)) {
      const outcome = await executeAction(action, ownerAuth, executionContext, summary);
      outcomes.push(outcome);
      if (outcome.ok) summary = `${summary} ${outcome.summary}`.trim().slice(0, 800);
    }
    const result: AutomationExecutionResult = { conditionMatched: true, outcomes };
    await repository.completeExecution(secret, claimed.id, result);
    await audit(repository, secret, workflow.id, "automation.execution.completed", "success", {
      workflowId: workflow.id,
      executionId: claimed.id,
      actions: outcomes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    await repository.failExecution(secret, claimed.id, message, {
      conditionMatched: true,
      outcomes,
    });
    await audit(repository, secret, workflow.id, "automation.execution.failed", "failure", {
      workflowId: workflow.id,
      executionId: claimed.id,
      error: message,
    });
    const priorRetry =
      typeof claimed.context.retryNumber === "number" ? claimed.context.retryNumber : 0;
    if (priorRetry + 1 < claimed.maxAttempts) {
      const retry = await repository.scheduleRetry(
        secret,
        claimed.id,
        {
          ...claimed.context,
          retryNumber: priorRetry + 1,
          completedOutcomes: outcomes,
        },
        new Date(Date.now() + workflow.retryDelaySeconds * 1000).toISOString(),
        priorRetry + 1
      );
      if (retry.created && retry.execution) {
        await audit(
          repository,
          secret,
          workflow.id,
          "automation.execution.retry_scheduled",
          "pending",
          { workflowId: workflow.id, executionId: retry.execution.id }
        );
      }
    }
  }

  return (await repository.getExecution(secret, claimed.id)) ?? claimed;
}

async function runDueWorkflow(
  repository: AutomationSchedulerRepository,
  secret: string,
  workflow: AutomationWorkflowRecord,
  now: Date
): Promise<AutomationExecutionRecord | null> {
  if (workflow.status !== "enabled" || workflow.trigger.type !== "schedule") return null;
  if (!workflow.nextRunAt || Date.parse(workflow.nextRunAt) > now.getTime()) return null;

  const scheduledFor = workflow.nextRunAt;
  const nextRunAt = computeNextRunAt(workflow.trigger, now, scheduledFor);
  if (!nextRunAt || Date.parse(nextRunAt) <= Date.parse(scheduledFor)) {
    throw new AutomationError(
      500,
      "STORAGE_UNAVAILABLE",
      "The next schedule slot could not be computed."
    );
  }

  const claim = await repository.claimDueWorkflow(
    secret,
    workflow.id,
    {
      event: {
        type: "schedule",
        occurredAt: scheduledFor,
        payload: { resourceType: "workflow", id: workflow.id },
      },
    },
    nextRunAt
  );
  if (!claim.claimed || !claim.execution) return null;

  if (claim.created) {
    await audit(repository, secret, workflow.id, "automation.execution.started", "success", {
      workflowId: workflow.id,
      executionId: claim.execution.id,
    });
  }
  if (claim.execution.status !== "pending") return claim.execution;
  return runScheduledExecution(repository, secret, claim.execution);
}

export async function processScheduledAutomations(
  secret: string,
  now = new Date()
): Promise<readonly AutomationExecutionRecord[]> {
  const repository = getAutomationSchedulerRepository();
  const results: AutomationExecutionRecord[] = [];

  const workflows = await repository.listDueWorkflows(secret, MAX_DUE_BATCH);
  for (const workflow of workflows) {
    try {
      const execution = await runDueWorkflow(repository, secret, workflow, now);
      if (execution) results.push(execution);
    } catch {
      continue;
    }
  }

  const pending = await repository.listDueExecutions(secret, MAX_DUE_BATCH);
  for (const execution of pending) {
    if (Date.parse(execution.scheduledFor) > now.getTime()) continue;
    try {
      results.push(await runScheduledExecution(repository, secret, execution));
    } catch {
      continue;
    }
  }

  return results;
}
