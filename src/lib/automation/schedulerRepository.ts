import "server-only";

import { AutomationError } from "@/lib/automation/errors";
import {
  mapAutomationAudit,
  mapAutomationExecution,
  mapAutomationWorkflow,
} from "@/lib/automation/repository";
import { MIN_SCHEDULER_SECRET_LENGTH } from "@/lib/automation/schedulerAuth";
import type {
  AutomationAuditRecord,
  AutomationExecutionRecord,
  AutomationExecutionResult,
  AutomationWorkflowRecord,
} from "@/lib/automation/types";

export interface AutomationSchedulerClaim {
  readonly claimed: boolean;
  readonly created: boolean;
  readonly execution: AutomationExecutionRecord | null;
}

export interface AutomationSchedulerRetry {
  readonly created: boolean;
  readonly execution: AutomationExecutionRecord | null;
}

export interface AutomationSchedulerAuditInput {
  readonly workflowId: string;
  readonly action: string;
  readonly outcome: "success" | "failure" | "denied" | "pending";
  readonly details?: Record<string, unknown>;
}

export interface AutomationSchedulerRepository {
  listDueWorkflows(
    secret: string,
    limit?: number
  ): Promise<readonly AutomationWorkflowRecord[]>;
  getWorkflow(
    secret: string,
    workflowId: string
  ): Promise<AutomationWorkflowRecord | null>;
  claimDueWorkflow(
    secret: string,
    workflowId: string,
    context: Record<string, unknown>,
    nextRunAt: string
  ): Promise<AutomationSchedulerClaim>;
  listDueExecutions(
    secret: string,
    limit?: number
  ): Promise<readonly AutomationExecutionRecord[]>;
  getExecution(
    secret: string,
    executionId: string
  ): Promise<AutomationExecutionRecord | null>;
  claimExecution(
    secret: string,
    executionId: string
  ): Promise<AutomationExecutionRecord | null>;
  completeExecution(
    secret: string,
    executionId: string,
    result: AutomationExecutionResult
  ): Promise<void>;
  failExecution(
    secret: string,
    executionId: string,
    error: string,
    result?: AutomationExecutionResult | null
  ): Promise<void>;
  skipExecution(
    secret: string,
    executionId: string,
    reason: string
  ): Promise<void>;
  scheduleRetry(
    secret: string,
    executionId: string,
    context: Record<string, unknown>,
    scheduledFor: string,
    retryNumber: number
  ): Promise<AutomationSchedulerRetry>;
  appendAudit(
    secret: string,
    input: AutomationSchedulerAuditInput
  ): Promise<AutomationAuditRecord>;
}

function requireSecret(secret: string): string {
  const trimmed = typeof secret === "string" ? secret.trim() : "";
  if (trimmed.length < MIN_SCHEDULER_SECRET_LENGTH) {
    throw new AutomationError(401, "FORBIDDEN", "Scheduler authentication required.");
  }
  return trimmed;
}

function storageError(operation: string, message: string): AutomationError {
  return new AutomationError(
    503,
    "STORAGE_UNAVAILABLE",
    `Scheduler ${operation} is unavailable. ${message.slice(0, 120)}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

const supabaseAutomationSchedulerRepository: AutomationSchedulerRepository = {
  async listDueWorkflows(rawSecret, limit) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "scheduler_list_due_automation_workflows",
      {
        p_secret: secret,
        p_limit: Math.max(1, Math.min(limit ?? 100, 200)),
      }
    );
    if (error) throw storageError("workflow scan", error.message);
    return (data ?? []).map(mapAutomationWorkflow);
  },

  async getWorkflow(rawSecret, workflowId) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("scheduler_get_automation_workflow", {
      p_secret: secret,
      p_workflow_id: workflowId,
    });
    if (error) throw storageError("workflow lookup", error.message);
    return data ? mapAutomationWorkflow(data) : null;
  },

  async claimDueWorkflow(rawSecret, workflowId, context, nextRunAt) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("scheduler_claim_due_automation", {
        p_secret: secret,
        p_workflow_id: workflowId,
        p_context: context,
        p_next_run_at: nextRunAt,
      })
      .single();
    if (error) throw storageError("due claim", error.message);
    if (!isRecord(data)) throw storageError("due claim", "No claim was returned.");
    return {
      claimed: data.claimed === true,
      created: data.created === true,
      execution: data.execution ? mapAutomationExecution(data.execution) : null,
    };
  },

  async listDueExecutions(rawSecret, limit) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "scheduler_list_due_automation_executions",
      {
        p_secret: secret,
        p_limit: Math.max(1, Math.min(limit ?? 100, 200)),
      }
    );
    if (error) throw storageError("execution scan", error.message);
    return (data ?? []).map(mapAutomationExecution);
  },

  async getExecution(rawSecret, executionId) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("scheduler_get_automation_execution", {
      p_secret: secret,
      p_execution_id: executionId,
    });
    if (error) throw storageError("execution lookup", error.message);
    return data ? mapAutomationExecution(data) : null;
  },

  async claimExecution(rawSecret, executionId) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("scheduler_claim_automation_execution", {
        p_secret: secret,
        p_execution_id: executionId,
      })
      .single();
    if (error) throw storageError("execution claim", error.message);
    return data ? mapAutomationExecution(data) : null;
  },

  async completeExecution(rawSecret, executionId, result) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { error } = await supabase.rpc("scheduler_complete_automation_execution", {
      p_secret: secret,
      p_execution_id: executionId,
      p_result: result as unknown as Record<string, unknown>,
    });
    if (error) throw storageError("execution completion", error.message);
  },

  async failExecution(rawSecret, executionId, message, result) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { error } = await supabase.rpc("scheduler_fail_automation_execution", {
      p_secret: secret,
      p_execution_id: executionId,
      p_error: message.slice(0, 500),
      p_result: (result ?? null) as unknown as Record<string, unknown> | null,
    });
    if (error) throw storageError("execution failure recording", error.message);
  },

  async skipExecution(rawSecret, executionId, reason) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { error } = await supabase.rpc("scheduler_skip_automation_execution", {
      p_secret: secret,
      p_execution_id: executionId,
      p_reason: reason.slice(0, 500),
    });
    if (error) throw storageError("execution skip recording", error.message);
  },

  async scheduleRetry(rawSecret, executionId, context, scheduledFor, retryNumber) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("scheduler_schedule_automation_retry", {
        p_secret: secret,
        p_execution_id: executionId,
        p_context: context,
        p_scheduled_for: scheduledFor,
        p_retry_number: retryNumber,
      })
      .single();
    if (error) throw storageError("retry scheduling", error.message);
    if (!isRecord(data)) throw storageError("retry scheduling", "No retry was returned.");
    return {
      created: data.created === true,
      execution: data.execution ? mapAutomationExecution(data.execution) : null,
    };
  },

  async appendAudit(rawSecret, input) {
    const secret = requireSecret(rawSecret);
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("scheduler_record_automation_audit", {
        p_secret: secret,
        p_workflow_id: input.workflowId,
        p_action: input.action,
        p_outcome: input.outcome,
        p_details: input.details ?? {},
      })
      .single();
    if (error) throw storageError("audit recording", error.message);
    if (!data) throw storageError("audit recording", "No audit event was returned.");
    return mapAutomationAudit(data);
  },
};

let activeRepository: AutomationSchedulerRepository =
  supabaseAutomationSchedulerRepository;

export function setAutomationSchedulerRepository(
  repository: AutomationSchedulerRepository
): void {
  activeRepository = repository;
}

export function resetAutomationSchedulerRepository(): void {
  activeRepository = supabaseAutomationSchedulerRepository;
}

export function getAutomationSchedulerRepository(): AutomationSchedulerRepository {
  return activeRepository;
}
