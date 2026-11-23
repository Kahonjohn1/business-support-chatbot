import "server-only";

import { AutomationError } from "@/lib/automation/errors";
import type {
  AutomationAuditInput,
  AutomationAuditRecord,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationExecutionStatus,
  AutomationScopeFilter,
  AutomationTriggerType,
  AutomationEventType,
  AutomationWorkflowDraft,
  AutomationWorkflowRecord,
  AutomationWorkflowStatus,
} from "@/lib/automation/types";
import {
  MAX_AUTOMATION_ATTEMPTS,
  normalizeWorkflowDraft,
} from "@/lib/automation/validation";

export interface AutomationWorkflowSaveInput {
  readonly id?: string;
  readonly draft: AutomationWorkflowDraft;
  readonly status: AutomationWorkflowStatus;
  readonly ownerRole: "viewer" | "operator" | "admin";
  readonly nextRunAt?: string | null;
}

export interface AutomationExecutionCreateInput {
  readonly workflowId: string;
  readonly triggerType: AutomationTriggerType;
  readonly eventType: AutomationEventType | null;
  readonly idempotencyKey: string;
  readonly context: Record<string, unknown>;
  readonly scheduledFor: string;
  readonly maxAttempts: number;
}

export interface AutomationExecutionOutcomeRecord {
  readonly execution: AutomationExecutionRecord;
  readonly created: boolean;
}

export interface AutomationExecutionListOptions {
  readonly workflowId?: string;
  readonly status?: AutomationExecutionStatus;
  readonly limit?: number;
}

export interface AutomationRepository {
  listWorkflows(
    filter: AutomationScopeFilter
  ): Promise<readonly AutomationWorkflowRecord[]>;
  getWorkflow(
    filter: AutomationScopeFilter,
    workflowId: string
  ): Promise<AutomationWorkflowRecord | null>;
  saveWorkflow(
    filter: AutomationScopeFilter,
    input: AutomationWorkflowSaveInput
  ): Promise<AutomationWorkflowRecord>;
  setWorkflowStatus(
    filter: AutomationScopeFilter,
    workflowId: string,
    status: AutomationWorkflowStatus
  ): Promise<AutomationWorkflowRecord | null>;
  setWorkflowNextRun(
    filter: AutomationScopeFilter,
    workflowId: string,
    nextRunAt: string | null
  ): Promise<void>;
  createExecution(
    filter: AutomationScopeFilter,
    input: AutomationExecutionCreateInput
  ): Promise<AutomationExecutionOutcomeRecord>;
  claimExecution(
    filter: AutomationScopeFilter,
    executionId: string
  ): Promise<AutomationExecutionRecord | null>;
  completeExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    result: AutomationExecutionResult
  ): Promise<void>;
  failExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    error: string,
    result?: AutomationExecutionResult | null
  ): Promise<void>;
  skipExecution(
    filter: AutomationScopeFilter,
    executionId: string,
    reason: string
  ): Promise<void>;
  listExecutions(
    filter: AutomationScopeFilter,
    options?: AutomationExecutionListOptions
  ): Promise<readonly AutomationExecutionRecord[]>;
  appendAudit(input: AutomationAuditInput): Promise<AutomationAuditRecord>;
  listAudit(
    filter: AutomationScopeFilter,
    limit: number
  ): Promise<readonly AutomationAuditRecord[]>;
}

const WORKFLOW_STATUSES: readonly AutomationWorkflowStatus[] = [
  "draft",
  "enabled",
  "paused",
  "disabled",
];

const EXECUTION_STATUSES: readonly AutomationExecutionStatus[] = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
];

const TRIGGER_TYPES: readonly AutomationTriggerType[] = [
  "schedule",
  "event",
  "manual",
];

const EVENT_TYPES: readonly AutomationEventType[] = [
  "task.created",
  "task.updated",
  "task.overdue",
  "project.created",
  "project.updated",
  "project.overdue",
];

const ROLES = ["viewer", "operator", "admin"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw storageError("record mapping", `Invalid ${key}.`);
  }
  return value;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string
): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw storageError("record mapping", `Invalid ${key}.`);
  }
  return value;
}

function readObject(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = row[key];
  return isRecord(value) ? value : {};
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw storageError("record mapping", `Invalid ${key}.`);
  }
  return value;
}

function readStatus<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw storageError("record mapping", `Invalid ${label}.`);
  }
  return value as T;
}

function readRole(value: unknown): "viewer" | "operator" | "admin" {
  return readStatus(value, ROLES, "owner role");
}

function normalizeFilter(filter: AutomationScopeFilter): AutomationScopeFilter {
  const userId = filter.userId?.trim();
  if (!userId) {
    throw new AutomationError(401, "FORBIDDEN", "Authentication required.");
  }
  if (filter.scope === "personal") return { scope: "personal", workspaceId: null, userId };
  const workspaceId = filter.workspaceId?.trim();
  if (!workspaceId) {
    throw new AutomationError(403, "FORBIDDEN", "A verified workspace is required.");
  }
  return { scope: "workspace", workspaceId, userId };
}

function storageError(operation: string, message: string): AutomationError {
  return new AutomationError(
    503,
    "STORAGE_UNAVAILABLE",
    `Automation ${operation} is unavailable. ${message.slice(0, 120)}`
  );
}

export function mapAutomationWorkflow(value: unknown): AutomationWorkflowRecord {
  if (!isRecord(value)) {
    throw storageError("record mapping", "Invalid workflow record.");
  }
  const draft = normalizeWorkflowDraft({
    name: readString(value, "name"),
    description: readNullableString(value, "description") ?? "",
    trigger: readObject(value, "trigger"),
    conditions: Array.isArray(value.conditions) ? value.conditions : [],
    actions: Array.isArray(value.actions) ? value.actions : [],
    maxActions: readNumber(value, "max_actions"),
    maxAttempts: readNumber(value, "max_attempts"),
    retryDelaySeconds: readNumber(value, "retry_delay_seconds"),
  });
  return {
    ...draft,
    id: readString(value, "id"),
    scope: readStatus(value.scope, ["personal", "workspace"] as const, "scope"),
    ownerUserId: readString(value, "owner_user_id"),
    workspaceId: readNullableString(value, "workspace_id"),
    createdByUserId: readString(value, "created_by_user_id"),
    ownerRole: readRole(value.owner_role),
    status: readStatus(value.status, WORKFLOW_STATUSES, "workflow status"),
    createdAt: readString(value, "created_at"),
    updatedAt: readString(value, "updated_at"),
    lastRunAt: readNullableString(value, "last_run_at"),
    nextRunAt: readNullableString(value, "next_run_at"),
  };
}

function readResult(value: unknown): AutomationExecutionResult | null {
  if (!isRecord(value) || !Array.isArray(value.outcomes)) return null;
  return {
    conditionMatched: value.conditionMatched === true,
    outcomes: value.outcomes.filter(isRecord).map((outcome) => ({
      action: readStatus(
        outcome.action,
        ["create_task", "status_check", "summary", "notify", "task_reminder"] as const,
        "action outcome"
      ),
      ok: outcome.ok === true,
      summary:
        typeof outcome.summary === "string" ? outcome.summary.slice(0, 400) : "",
    })),
  };
}

export function mapAutomationExecution(value: unknown): AutomationExecutionRecord {
  if (!isRecord(value)) {
    throw storageError("record mapping", "Invalid execution record.");
  }
  const eventType = readNullableString(value, "event_type");
  return {
    id: readString(value, "id"),
    workflowId: readString(value, "workflow_id"),
    ownerUserId: readString(value, "owner_user_id"),
    scope: readStatus(value.scope, ["personal", "workspace"] as const, "scope"),
    workspaceId: readNullableString(value, "workspace_id"),
    triggerType: readStatus(value.trigger_type, TRIGGER_TYPES, "trigger type"),
    eventType: eventType
      ? readStatus(eventType, EVENT_TYPES, "event type")
      : null,
    idempotencyKey: readString(value, "idempotency_key"),
    status: readStatus(value.status, EXECUTION_STATUSES, "execution status"),
    attempts: readNumber(value, "attempts"),
    maxAttempts: Math.max(
      1,
      Math.min(MAX_AUTOMATION_ATTEMPTS, readNumber(value, "max_attempts"))
    ),
    context: readObject(value, "context"),
    result: readResult(value.result),
    error: readNullableString(value, "error"),
    scheduledFor: readString(value, "scheduled_for"),
    nextAttemptAt: readNullableString(value, "next_attempt_at"),
    startedAt: readNullableString(value, "started_at"),
    finishedAt: readNullableString(value, "finished_at"),
    createdAt: readString(value, "created_at"),
  };
}

export function mapAutomationAudit(value: unknown): AutomationAuditRecord {
  if (!isRecord(value)) {
    throw storageError("record mapping", "Invalid audit record.");
  }
  return {
    id: readString(value, "id"),
    workflowId: readNullableString(value, "workflow_id"),
    ownerUserId: readString(value, "owner_user_id"),
    scope: readStatus(value.scope, ["personal", "workspace"] as const, "scope"),
    workspaceId: readNullableString(value, "workspace_id"),
    actorUserId: readString(value, "actor_user_id"),
    action: readString(value, "action"),
    outcome: readStatus(
      value.outcome,
      ["success", "failure", "denied", "pending"] as const,
      "audit outcome"
    ),
    details: readObject(value, "details"),
    createdAt: readString(value, "created_at"),
  };
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

const supabaseAutomationRepository: AutomationRepository = {
  async listWorkflows(rawFilter) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_automation_workflows", {
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
    });
    if (error) throw storageError("workflow listing", error.message);
    return (data ?? []).map(mapAutomationWorkflow);
  },

  async getWorkflow(rawFilter, workflowId) {
    const filter = normalizeFilter(rawFilter);
    if (!workflowId?.trim()) {
      throw new AutomationError(400, "INVALID_REQUEST", "Workflow id is required.");
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_automation_workflow", {
      p_workflow_id: workflowId.trim(),
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
    });
    if (error) throw storageError("workflow lookup", error.message);
    return data ? mapAutomationWorkflow(data) : null;
  },

  async saveWorkflow(rawFilter, input) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("upsert_automation_workflow", {
        p_workflow_id: input.id ?? null,
        p_scope: filter.scope,
        p_workspace_id: filter.workspaceId,
        p_name: input.draft.name,
        p_description: input.draft.description,
        p_trigger: input.draft.trigger,
        p_conditions: input.draft.conditions as unknown as Record<string, unknown>[],
        p_actions: input.draft.actions as unknown as Record<string, unknown>[],
        p_max_actions: input.draft.maxActions,
        p_max_attempts: input.draft.maxAttempts,
        p_retry_delay_seconds: input.draft.retryDelaySeconds,
        p_owner_role: input.ownerRole,
        p_status: input.status,
        p_next_run_at: input.nextRunAt ?? null,
      })
      .single();
    if (error) throw storageError("workflow save", error.message);
    if (!data) throw storageError("workflow save", "No workflow was returned.");
    return mapAutomationWorkflow(data);
  },

  async setWorkflowStatus(rawFilter, workflowId, status) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("set_automation_workflow_status", {
        p_workflow_id: workflowId,
        p_scope: filter.scope,
        p_workspace_id: filter.workspaceId,
        p_status: status,
      })
      .single();
    if (error) throw storageError("status update", error.message);
    return data ? mapAutomationWorkflow(data) : null;
  },

  async setWorkflowNextRun(rawFilter, workflowId, nextRunAt) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_automation_next_run", {
      p_workflow_id: workflowId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_next_run_at: nextRunAt,
    });
    if (error) throw storageError("schedule update", error.message);
  },

  async createExecution(rawFilter, input) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("create_automation_execution", {
        p_workflow_id: input.workflowId,
        p_scope: filter.scope,
        p_workspace_id: filter.workspaceId,
        p_trigger_type: input.triggerType,
        p_event_type: input.eventType,
        p_idempotency_key: input.idempotencyKey,
        p_context: input.context,
        p_scheduled_for: input.scheduledFor,
        p_max_attempts: input.maxAttempts,
      })
      .single();
    if (error) throw storageError("execution creation", error.message);
    if (!data || !isRecord(data)) {
      throw storageError("execution creation", "No execution was returned.");
    }
    return {
      execution: mapAutomationExecution(data.execution ?? data),
      created: data.created !== false,
    };
  },

  async claimExecution(rawFilter, executionId) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("claim_automation_execution", {
        p_execution_id: executionId,
        p_scope: filter.scope,
        p_workspace_id: filter.workspaceId,
      })
      .single();
    if (error) throw storageError("execution claim", error.message);
    return data ? mapAutomationExecution(data) : null;
  },

  async completeExecution(rawFilter, executionId, result) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { error } = await supabase.rpc("complete_automation_execution", {
      p_execution_id: executionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_result: result as unknown as Record<string, unknown>,
    });
    if (error) throw storageError("execution completion", error.message);
  },

  async failExecution(rawFilter, executionId, message, result) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_automation_execution_failure", {
      p_execution_id: executionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_error: message.slice(0, 500),
      p_result: (result ?? null) as unknown as Record<string, unknown> | null,
    });
    if (error) throw storageError("execution failure recording", error.message);
  },

  async skipExecution(rawFilter, executionId, reason) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { error } = await supabase.rpc("skip_automation_execution", {
      p_execution_id: executionId,
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_error: reason.slice(0, 500),
    });
    if (error) throw storageError("execution skip recording", error.message);
  },

  async listExecutions(rawFilter, options) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_automation_executions", {
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_workflow_id: options?.workflowId ?? null,
      p_status: options?.status ?? null,
      p_limit: Math.max(1, Math.min(options?.limit ?? 50, 200)),
    });
    if (error) throw storageError("execution listing", error.message);
    return (data ?? []).map(mapAutomationExecution);
  },

  async appendAudit(input) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("record_automation_audit_event", {
        p_workflow_id: input.workflowId ?? null,
        p_scope: input.scope,
        p_workspace_id: input.workspaceId,
        p_actor_user_id: input.actorUserId,
        p_action: input.action,
        p_outcome: input.outcome,
        p_details: input.details ?? {},
      })
      .single();
    if (error) throw storageError("audit recording", error.message);
    if (!data) throw storageError("audit recording", "No audit event was returned.");
    return mapAutomationAudit(data);
  },

  async listAudit(rawFilter, limit) {
    const filter = normalizeFilter(rawFilter);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_automation_audit_events", {
      p_scope: filter.scope,
      p_workspace_id: filter.workspaceId,
      p_limit: Math.max(1, Math.min(limit, 200)),
    });
    if (error) throw storageError("audit listing", error.message);
    return (data ?? []).map(mapAutomationAudit);
  },
};

let activeRepository: AutomationRepository = supabaseAutomationRepository;

export function setAutomationRepository(repository: AutomationRepository): void {
  activeRepository = repository;
}

export function resetAutomationRepository(): void {
  activeRepository = supabaseAutomationRepository;
}

export function getAutomationRepository(): AutomationRepository {
  return activeRepository;
}
