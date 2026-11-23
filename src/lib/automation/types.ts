export type AutomationScope = "personal" | "workspace";

export type AutomationWorkflowStatus =
  | "draft"
  | "enabled"
  | "paused"
  | "disabled";

export type AutomationTriggerType = "schedule" | "event" | "manual";

export type AutomationEventType =
  | "task.created"
  | "task.updated"
  | "task.overdue"
  | "project.created"
  | "project.updated"
  | "project.overdue";

export type AutomationActionType =
  | "create_task"
  | "status_check"
  | "summary"
  | "notify"
  | "task_reminder";

export type AutomationConditionField =
  | "event.type"
  | "task.status"
  | "task.priority"
  | "task.title"
  | "task.overdue"
  | "task.ageDays"
  | "project.status"
  | "project.name"
  | "project.ageDays";

export type AutomationConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gte"
  | "lte"
  | "is_true"
  | "is_false";

export type AutomationResourceKind = "task" | "project";

export interface AutomationTriggerConfig {
  readonly type: AutomationTriggerType;
  readonly eventType?: AutomationEventType;
  readonly interval?: "daily" | "weekly" | "monthly";
  readonly time?: string;
  readonly dayOfWeek?: number;
  readonly dayOfMonth?: number;
}

export interface AutomationCondition {
  readonly field: AutomationConditionField;
  readonly operator: AutomationConditionOperator;
  readonly value?: string | number | boolean;
}

export interface AutomationAction {
  readonly type: AutomationActionType;
  readonly title?: string;
  readonly description?: string;
  readonly priority?: "low" | "medium" | "high";
  readonly assignee?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly resource?: AutomationResourceKind;
  readonly id?: string;
  readonly name?: string;
  readonly expectedStatus?: string;
  readonly message?: string;
  readonly taskId?: string;
  readonly taskTitle?: string;
  readonly filter?: {
    readonly status?: string;
  };
  readonly limit?: number;
}

export interface AutomationWorkflowDraft {
  readonly name: string;
  readonly description: string;
  readonly trigger: AutomationTriggerConfig;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
  readonly maxActions: number;
  readonly maxAttempts: number;
  readonly retryDelaySeconds: number;
}

export interface AutomationWorkflowRecord extends AutomationWorkflowDraft {
  readonly id: string;
  readonly scope: AutomationScope;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly createdByUserId: string;
  readonly ownerRole: "viewer" | "operator" | "admin";
  readonly status: AutomationWorkflowStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
}

export type AutomationExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface AutomationActionOutcome {
  readonly action: AutomationActionType;
  readonly ok: boolean;
  readonly summary: string;
}

export interface AutomationExecutionResult {
  readonly outcomes: readonly AutomationActionOutcome[];
  readonly conditionMatched: boolean;
}

export interface AutomationExecutionRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly ownerUserId: string;
  readonly scope: AutomationScope;
  readonly workspaceId: string | null;
  readonly triggerType: AutomationTriggerType;
  readonly eventType: AutomationEventType | null;
  readonly idempotencyKey: string;
  readonly status: AutomationExecutionStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly context: Readonly<Record<string, unknown>>;
  readonly result: AutomationExecutionResult | null;
  readonly error: string | null;
  readonly scheduledFor: string;
  readonly nextAttemptAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
}

export interface AutomationAuditRecord {
  readonly id: string;
  readonly workflowId: string | null;
  readonly ownerUserId: string;
  readonly scope: AutomationScope;
  readonly workspaceId: string | null;
  readonly actorUserId: string;
  readonly action: string;
  readonly outcome: "success" | "failure" | "denied" | "pending";
  readonly details: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface AutomationAuditInput {
  readonly workflowId?: string | null;
  readonly scope: AutomationScope;
  readonly workspaceId: string | null;
  readonly actorUserId: string;
  readonly action: string;
  readonly outcome: "success" | "failure" | "denied" | "pending";
  readonly details?: Record<string, unknown>;
}

export interface AutomationScopeFilter {
  readonly scope: AutomationScope;
  readonly workspaceId: string | null;
  readonly userId: string;
}

export interface AutomationContext {
  readonly scope: AutomationScope;
  readonly workspaceId: string | null;
  readonly actorUserId: string;
  readonly actorRole: "viewer" | "operator" | "admin";
  readonly auth: import("@/lib/permissions").AuthorizationContext;
}

export interface AutomationEvent {
  readonly type: AutomationEventType;
  readonly occurredAt: string;
  readonly depth?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AutomationWorkflowProposal {
  readonly ok: boolean;
  readonly name: string;
  readonly description: string;
  readonly draft: AutomationWorkflowDraft | null;
  readonly explanation: readonly string[];
  readonly missingDetails: readonly string[];
}

export interface AutomationExecutionOutcome {
  readonly execution: AutomationExecutionRecord;
  readonly created: boolean;
}
