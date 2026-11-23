import { AutomationError } from "@/lib/automation/errors";
import {
  automationFilter,
  authorizationForWorkflow,
  requireAutomationPermission,
  resolveAutomationContext,
} from "@/lib/automation/context";
import { getAutomationRepository } from "@/lib/automation/repository";
import type {
  AutomationAction,
  AutomationActionOutcome,
  AutomationCondition,
  AutomationContext,
  AutomationEvent,
  AutomationEventType,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationScopeFilter,
  AutomationTriggerConfig,
  AutomationWorkflowDraft,
  AutomationWorkflowRecord,
  AutomationWorkflowStatus,
} from "@/lib/automation/types";
import {
  canonicalJson,
  normalizeWorkflowDraft,
} from "@/lib/automation/validation";
import type { AuthorizationContext } from "@/lib/permissions";
import type {
  PersonalProjectRecord,
  PersonalTaskRecord,
} from "@/lib/personalProjectData";
import {
  findWorkspaceProjectsByName,
  getWorkspaceProjectById,
  listWorkspaceProjects,
  listWorkspaceTasks,
  createWorkspaceTask,
} from "@/lib/workspace/workspaceProjectData";

const MAX_PROJECT_SCAN = 25;
const MAX_EVENT_DEPTH = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, max = 400): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function sanitizeContext(value: unknown): Record<string, unknown> {
  const sensitive = /key|token|secret|password|cookie|authorization/i;
  if (Array.isArray(value)) {
    return { items: value.slice(0, 20).map((item) => sanitizeContext(item)) };
  }
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 30)) {
    if (sensitive.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      result[key] = typeof entry === "string" ? cleanString(entry) : entry;
    } else if (entry === null) {
      result[key] = null;
    } else {
      result[key] = sanitizeContext(entry);
    }
  }
  return result;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":");
  return { hour: Number(hour), minute: Number(minute) };
}

function nextScheduleDate(trigger: AutomationTriggerConfig, now: Date): Date | null {
  if (trigger.type !== "schedule" || !trigger.time) return null;
  const { hour, minute } = parseTime(trigger.time);
  const candidate = new Date(now);
  candidate.setUTCHours(hour, minute, 0, 0);

  if (trigger.interval === "daily") {
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }
  if (trigger.interval === "weekly") {
    const target = trigger.dayOfWeek ?? 1;
    const delta = (target - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + delta);
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }
  const targetDay = trigger.dayOfMonth ?? 1;
  if (candidate.getUTCDate() !== targetDay) {
    candidate.setUTCDate(1);
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
    candidate.setUTCDate(targetDay);
  }
  if (candidate <= now) {
    candidate.setUTCDate(1);
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
    candidate.setUTCDate(targetDay);
  }
  return candidate;
}

export function computeNextRunAt(
  trigger: AutomationTriggerConfig,
  now = new Date()
): string | null {
  return nextScheduleDate(trigger, now)?.toISOString() ?? null;
}

function fieldValue(
  field: AutomationCondition["field"],
  context: Record<string, unknown>
): unknown {
  const event = isRecord(context.event) ? context.event : {};
  const payload = isRecord(event.payload) ? event.payload : {};
  const task = isRecord(payload.task) ? payload.task : payload;
  const project = isRecord(payload.project) ? payload.project : payload;

  if (field === "event.type") return event.type;
  if (field.startsWith("task.")) {
    if (field === "task.ageDays") return ageDays(task.updatedAt ?? event.occurredAt);
    return task[field.slice("task.".length)];
  }
  if (field.startsWith("project.")) {
    if (field === "project.ageDays") return ageDays(project.updatedAt ?? event.occurredAt);
    return project[field.slice("project.".length)];
  }
  return undefined;
}

function ageDays(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function evaluateCondition(
  condition: AutomationCondition,
  context: Record<string, unknown>
): boolean {
  const actual = fieldValue(condition.field, context);
  if (condition.operator === "is_true") return actual === true;
  if (condition.operator === "is_false") return actual === false || actual === undefined;
  if (actual === undefined || actual === null) return false;
  const expected = condition.value;

  if (condition.operator === "equals") return String(actual) === String(expected);
  if (condition.operator === "not_equals") return String(actual) !== String(expected);
  if (condition.operator === "contains") {
    return String(actual).toLowerCase().includes(String(expected ?? "").toLowerCase());
  }
  if (condition.operator === "not_contains") {
    return !String(actual).toLowerCase().includes(String(expected ?? "").toLowerCase());
  }
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (condition.operator === "gte") return actualNumber >= expectedNumber;
  if (condition.operator === "lte") return actualNumber <= expectedNumber;
  return false;
}

function matchesConditions(
  conditions: readonly AutomationCondition[],
  context: Record<string, unknown>
): boolean {
  return conditions.every((condition) => evaluateCondition(condition, context));
}

function interpolate(
  template: string,
  context: Record<string, unknown>,
  summary?: string
): string {
  return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_match, key: string) => {
    if (key === "summary") return summary ?? "";
    const event = isRecord(context.event) ? context.event : {};
    const payload = isRecord(event.payload) ? event.payload : {};
    const parts = key.split(".");
    let current: unknown = { event, ...payload };
    for (const part of parts) {
      if (!isRecord(current)) return "";
      current = current[part];
    }
    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      return String(current);
    }
    return "";
  });
}

async function resolveProject(
  auth: AuthorizationContext,
  action: AutomationAction,
  context: Record<string, unknown>
): Promise<PersonalProjectRecord | null> {
  const projectId = interpolate(action.projectId ?? "", context);
  if (projectId) return getWorkspaceProjectById(auth, projectId);
  const projectName = interpolate(action.projectName ?? "", context);
  if (!projectName) return null;
  const matches = await findWorkspaceProjectsByName(auth, projectName);
  return matches[0] ?? null;
}

async function resolveTask(
  auth: AuthorizationContext,
  action: AutomationAction,
  context: Record<string, unknown>
): Promise<PersonalTaskRecord | null> {
  const taskId = interpolate(action.taskId ?? action.id ?? "", context);
  const taskTitle = interpolate(action.taskTitle ?? action.name ?? "", context);
  const projects = await listWorkspaceProjects(auth);
  for (const project of projects.slice(0, MAX_PROJECT_SCAN)) {
    const tasks = await listWorkspaceTasks(auth, project.id);
    const match = tasks.find(
      (task) =>
        (taskId && task.id === taskId) ||
        (taskTitle && task.title.toLowerCase() === taskTitle.toLowerCase())
    );
    if (match) return match;
  }
  return null;
}

function actionPermission(action: AutomationAction): string {
  if (action.type === "create_task") return "create_project_task";
  if (action.type === "notify") return "list_projects";
  if (action.type === "status_check" || action.type === "summary") {
    return action.resource === "task" ? "list_project_tasks" : "list_projects";
  }
  return "list_project_tasks";
}

async function executeAction(
  action: AutomationAction,
  auth: AuthorizationContext,
  context: Record<string, unknown>,
  priorSummary: string
): Promise<AutomationActionOutcome> {
  requireAutomationPermission(actionPermission(action), auth);

  if (action.type === "notify") {
    const message = cleanString(interpolate(action.message ?? "", context, priorSummary));
    return { action: action.type, ok: Boolean(message), summary: message || "No notification message." };
  }

  if (action.type === "create_task") {
    const project = await resolveProject(auth, action, context);
    if (!project) {
      return { action: action.type, ok: false, summary: "Project was not found." };
    }
    const title = cleanString(interpolate(action.title ?? "", context, priorSummary), 100);
    const task = await createWorkspaceTask(auth, {
      projectId: project.id,
      title,
      ...(action.description
        ? { description: cleanString(interpolate(action.description, context, priorSummary)) }
        : {}),
      ...(action.priority ? { priority: action.priority } : {}),
      ...(action.assignee ? { assignee: cleanString(action.assignee, 50) } : {}),
    });
    return {
      action: action.type,
      ok: true,
      summary: `Created task "${task.title}" in ${project.name}.`,
    };
  }

  if (action.type === "status_check") {
    if (action.resource === "project") {
      const project = await resolveProject(auth, { ...action, projectId: action.id }, context);
      if (!project) return { action: action.type, ok: false, summary: "Project was not found." };
      return {
        action: action.type,
        ok: true,
        summary: `Project ${project.name} status is ${project.status}.`,
      };
    }
    const task = await resolveTask(auth, action, context);
    if (!task) return { action: action.type, ok: false, summary: "Task was not found." };
    return { action: action.type, ok: true, summary: `Task ${task.title} status is ${task.status}.` };
  }

  if (action.type === "summary") {
    const limit = action.limit ?? 10;
    if (action.resource === "project") {
      const projects = await listWorkspaceProjects(auth);
      const filtered = projects
        .filter((project) => !action.filter?.status || project.status === action.filter.status)
        .slice(0, limit);
      const summary = filtered.length
        ? filtered.map((project) => `${project.name}: ${project.status}`).join("; ")
        : "No matching projects.";
      return { action: action.type, ok: true, summary: `Projects: ${summary}` };
    }
    const projects = await listWorkspaceProjects(auth);
    const summaries: string[] = [];
    for (const project of projects.slice(0, MAX_PROJECT_SCAN)) {
      if (summaries.length >= limit) break;
      const tasks = await listWorkspaceTasks(auth, project.id);
      for (const task of tasks) {
        if (action.filter?.status && task.status !== action.filter.status) continue;
        summaries.push(`${task.title}: ${task.status}`);
        if (summaries.length >= limit) break;
      }
    }
    return {
      action: action.type,
      ok: true,
      summary: `Tasks: ${summaries.length ? summaries.join("; ") : "No matching tasks."}`,
    };
  }

  const task = await resolveTask(auth, action, context);
  if (!task) return { action: action.type, ok: false, summary: "Task was not found." };
  const message = action.message
    ? cleanString(interpolate(action.message, context, priorSummary))
    : `Reminder for ${task.title}.`;
  return { action: action.type, ok: true, summary: message };
}

async function audit(
  context: AutomationContext,
  action: string,
  outcome: "success" | "failure" | "denied" | "pending",
  details: Record<string, unknown>
): Promise<void> {
  try {
    await getAutomationRepository().appendAudit({
      workflowId: typeof details.workflowId === "string" ? details.workflowId : null,
      scope: context.scope,
      workspaceId: context.workspaceId,
      actorUserId: context.actorUserId,
      action,
      outcome,
      details: sanitizeContext(details),
    });
  } catch {
    return;
  }
}

async function runExecution(
  executionId: string,
  filter: AutomationScopeFilter,
  context: AutomationContext
): Promise<AutomationExecutionRecord> {
  const repository = getAutomationRepository();
  const claimed = await repository.claimExecution(filter, executionId);
  if (!claimed) {
    const executions = await repository.listExecutions(filter, { limit: 200 });
    const existing = executions.find((item) => item.id === executionId);
    if (!existing) {
      throw new AutomationError(404, "NOT_FOUND", "Execution was not found.");
    }
    return existing;
  }

  const workflow = await repository.getWorkflow(filter, claimed.workflowId);
  if (!workflow) {
    await repository.failExecution(filter, executionId, "Workflow no longer exists.");
    return (await repository.listExecutions(filter, { limit: 200 })).find(
      (item) => item.id === executionId
    ) ?? claimed;
  }

  const executionContext = sanitizeContext(claimed.context);
  const matched = matchesConditions(workflow.conditions, executionContext);
  if (!matched) {
    await repository.skipExecution(filter, executionId, "Conditions did not match.");
    await audit(context, "automation.execution.skipped", "success", {
      workflowId: workflow.id,
      executionId,
    });
    return (await repository.listExecutions(filter, { limit: 200 })).find(
      (item) => item.id === executionId
    ) ?? claimed;
  }

  const outcomes: AutomationActionOutcome[] = [];
  let summary = "";
  try {
    const systemAuth = await authorizationForWorkflow(workflow);
    for (const action of workflow.actions.slice(0, workflow.maxActions)) {
      const outcome = await executeAction(action, systemAuth, executionContext, summary);
      outcomes.push(outcome);
      if (outcome.ok) summary = `${summary} ${outcome.summary}`.trim().slice(0, 800);
    }
    const result: AutomationExecutionResult = {
      conditionMatched: true,
      outcomes,
    };
    await repository.completeExecution(filter, executionId, result);
    if (workflow.trigger.type === "schedule") {
      await repository.setWorkflowNextRun(
        filter,
        workflow.id,
        computeNextRunAt(workflow.trigger)
      );
    }
    await audit(context, "automation.execution.completed", "success", {
      workflowId: workflow.id,
      executionId,
      actions: outcomes.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    await repository.failExecution(filter, executionId, message);
    await audit(context, "automation.execution.failed", "failure", {
      workflowId: workflow.id,
      executionId,
      error: message,
    });
    const current = (await repository.listExecutions(filter, { limit: 200 })).find(
      (item) => item.id === executionId
    );
    const priorRetry =
      typeof current?.context.retryNumber === "number"
        ? current.context.retryNumber
        : 0;
    if (current && priorRetry + 1 < current.maxAttempts) {
      const retryKey = `${current.idempotencyKey}:retry:${priorRetry + 1}`;
      const retry = await repository.createExecution(filter, {
        workflowId: workflow.id,
        triggerType: current.triggerType,
        eventType: current.eventType,
        idempotencyKey: retryKey,
        context: { ...current.context, retryNumber: priorRetry + 1 },
        scheduledFor: new Date(Date.now() + workflow.retryDelaySeconds * 1000).toISOString(),
        maxAttempts: current.maxAttempts,
      });
      if (retry.created) {
        await audit(context, "automation.execution.retry_scheduled", "pending", {
          workflowId: workflow.id,
          executionId: retry.execution.id,
        });
      }
    }
    return (
      (await repository.listExecutions(filter, { limit: 200 })).find(
        (item) => item.id === executionId
      ) ?? current ?? claimed
    );
  }

  return (
    (await repository.listExecutions(filter, { limit: 200 })).find(
      (item) => item.id === executionId
    ) ?? claimed
  );
}

export async function createAutomationWorkflow(
  auth: AuthorizationContext | undefined,
  value: unknown
): Promise<AutomationWorkflowRecord> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("create_automation_workflow", context.auth);
  const draft = normalizeWorkflowDraft(value);
  const repository = getAutomationRepository();
  const workflow = await repository.saveWorkflow(automationFilter(context), {
    draft,
    status: "enabled",
    ownerRole: context.actorRole,
    nextRunAt: computeNextRunAt(draft.trigger),
  });
  await audit(context, "automation.workflow.created", "success", {
    workflowId: workflow.id,
    trigger: draft.trigger.type,
    actions: draft.actions.length,
  });
  return workflow;
}

export async function listAutomationWorkflows(
  auth: AuthorizationContext | undefined
): Promise<readonly AutomationWorkflowRecord[]> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("list_automation_workflows", context.auth);
  return getAutomationRepository().listWorkflows(automationFilter(context));
}

export async function setAutomationWorkflowStatus(
  auth: AuthorizationContext | undefined,
  workflowId: string,
  status: AutomationWorkflowStatus
): Promise<AutomationWorkflowRecord> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("update_automation_workflow", context.auth);
  const allowed: readonly AutomationWorkflowStatus[] = [
    "draft",
    "enabled",
    "paused",
    "disabled",
  ];
  if (!allowed.includes(status)) {
    throw new AutomationError(400, "INVALID_REQUEST", "Invalid automation status.");
  }
  const filter = automationFilter(context);
  const repository = getAutomationRepository();
  const workflow = await repository.setWorkflowStatus(filter, workflowId, status);
  if (!workflow) throw new AutomationError(404, "NOT_FOUND", "Workflow was not found.");
  if (status === "enabled") {
    await repository.setWorkflowNextRun(
      filter,
      workflowId,
      computeNextRunAt(workflow.trigger)
    );
  }
  await audit(context, "automation.workflow.status", "success", {
    workflowId,
    status,
  });
  return { ...workflow, nextRunAt: status === "enabled" ? computeNextRunAt(workflow.trigger) : null };
}

export async function listAutomationExecutions(
  auth: AuthorizationContext | undefined,
  workflowId?: string
): Promise<readonly AutomationExecutionRecord[]> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("list_automation_workflows", context.auth);
  return getAutomationRepository().listExecutions(automationFilter(context), {
    workflowId,
    limit: 100,
  });
}

export async function listAutomationAudit(
  auth: AuthorizationContext | undefined
): Promise<readonly import("@/lib/automation/types").AutomationAuditRecord[]> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("list_automation_workflows", context.auth);
  return getAutomationRepository().listAudit(automationFilter(context), 100);
}

export async function runAutomationNow(
  auth: AuthorizationContext | undefined,
  workflowId: string
): Promise<AutomationExecutionRecord> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("execute_automation_workflow", context.auth);
  const filter = automationFilter(context);
  const workflow = await getAutomationRepository().getWorkflow(filter, workflowId);
  if (!workflow) throw new AutomationError(404, "NOT_FOUND", "Workflow was not found.");
  const now = new Date().toISOString();
  const execution = await getAutomationRepository().createExecution(filter, {
    workflowId,
    triggerType: "manual",
    eventType: null,
    idempotencyKey: `manual:${workflowId}:${now}`,
    context: {
      event: {
        type: "manual",
        occurredAt: now,
        payload: { resourceType: "workflow", id: workflowId },
      },
      actor: { userId: context.actorUserId, role: context.actorRole },
    },
    scheduledFor: now,
    maxAttempts: workflow.maxAttempts,
  });
  await audit(context, "automation.execution.started", "success", {
    workflowId,
    executionId: execution.execution.id,
  });
  return runExecution(execution.execution.id, filter, context);
}

export async function dispatchAutomationEvent(
  auth: AuthorizationContext | undefined,
  event: AutomationEvent
): Promise<readonly AutomationExecutionRecord[]> {
  if ((event.depth ?? 0) > MAX_EVENT_DEPTH) return [];
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("list_automation_workflows", context.auth);
  const filter = automationFilter(context);
  const workflows = await getAutomationRepository().listWorkflows(filter);
  const executionContext = sanitizeContext({
    event: {
      type: event.type,
      occurredAt: event.occurredAt,
      depth: event.depth ?? 0,
      payload: event.payload,
    },
    actor: { userId: context.actorUserId, role: context.actorRole },
  });
  const results: AutomationExecutionRecord[] = [];
  const dedupe =
    cleanString(
      String(event.payload.id ?? event.payload.projectId ?? canonicalJson(event.payload)),
      120
    ) || "unknown";

  for (const workflow of workflows) {
    if (workflow.status !== "enabled") continue;
    if (workflow.trigger.type !== "event" || workflow.trigger.eventType !== event.type) {
      continue;
    }
    if (!matchesConditions(workflow.conditions, executionContext)) continue;
    const scheduledFor = event.occurredAt;
    const created = await getAutomationRepository().createExecution(filter, {
      workflowId: workflow.id,
      triggerType: "event",
      eventType: event.type,
      idempotencyKey: `event:${event.type}:${dedupe}:${scheduledFor}`,
      context: executionContext,
      scheduledFor,
      maxAttempts: workflow.maxAttempts,
    });
    if (!created.created) continue;
    results.push(await runExecution(created.execution.id, filter, context));
  }
  return results;
}

export async function processDueAutomations(
  auth: AuthorizationContext | undefined
): Promise<readonly AutomationExecutionRecord[]> {
  const context = await resolveAutomationContext(auth);
  requireAutomationPermission("execute_automation_workflow", context.auth);
  const filter = automationFilter(context);
  const repository = getAutomationRepository();
  const workflows = await repository.listWorkflows(filter);
  const now = new Date();
  const results: AutomationExecutionRecord[] = [];

  for (const workflow of workflows) {
    if (workflow.status !== "enabled" || workflow.trigger.type !== "schedule") continue;
    if (!workflow.nextRunAt || Date.parse(workflow.nextRunAt) > now.getTime()) continue;
    const scheduledFor = workflow.nextRunAt;
    const created = await repository.createExecution(filter, {
      workflowId: workflow.id,
      triggerType: "schedule",
      eventType: null,
      idempotencyKey: `schedule:${workflow.id}:${scheduledFor}`,
      context: {
        event: {
          type: "schedule",
          occurredAt: scheduledFor,
          payload: { resourceType: "workflow", id: workflow.id },
        },
      },
      scheduledFor,
      maxAttempts: workflow.maxAttempts,
    });
    if (created.created) {
      results.push(await runExecution(created.execution.id, filter, context));
    }
    await repository.setWorkflowNextRun(
      filter,
      workflow.id,
      computeNextRunAt(workflow.trigger, now)
    );
  }

  const pending = await repository.listExecutions(filter, {
    status: "pending",
    limit: 100,
  });
  for (const execution of pending) {
    if (Date.parse(execution.scheduledFor) > now.getTime()) continue;
    results.push(await runExecution(execution.id, filter, context));
  }
  return results;
}

export async function emitTaskEvent(
  auth: AuthorizationContext | undefined,
  type: AutomationEventType,
  task: PersonalTaskRecord,
  depth = 0
): Promise<void> {
  await dispatchAutomationEvent(auth, {
    type,
    occurredAt: new Date().toISOString(),
    depth,
    payload: {
      resourceType: "task",
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        updatedAt: task.createdAt,
        overdue: task.status !== "done" && Boolean((task as { dueAt?: unknown }).dueAt),
      },
      project: { id: task.projectId },
    },
  });
}

export async function emitProjectEvent(
  auth: AuthorizationContext | undefined,
  type: AutomationEventType,
  project: PersonalProjectRecord,
  depth = 0
): Promise<void> {
  await dispatchAutomationEvent(auth, {
    type,
    occurredAt: new Date().toISOString(),
    depth,
    payload: {
      resourceType: "project",
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        updatedAt: project.updatedAt,
      },
    },
  });
}

export function isAutomationEventType(value: string): value is AutomationEventType {
  return [
    "task.created",
    "task.updated",
    "task.overdue",
    "project.created",
    "project.updated",
    "project.overdue",
  ].includes(value);
}

export function draftFromProposal(
  proposal: { readonly draft?: AutomationWorkflowDraft | null }
): AutomationWorkflowDraft {
  if (!proposal.draft) {
    throw new AutomationError(400, "INVALID_REQUEST", "The workflow proposal is incomplete.");
  }
  return normalizeWorkflowDraft(proposal.draft);
}
