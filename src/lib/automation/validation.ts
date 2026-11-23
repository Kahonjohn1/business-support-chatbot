import { AutomationError } from "@/lib/automation/errors";
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationEventType,
  AutomationTriggerConfig,
  AutomationTriggerType,
  AutomationWorkflowDraft,
} from "@/lib/automation/types";

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
const MESSAGE_MAX = 400;
const TITLE_MAX = 100;
const SHORT_TEXT_MAX = 120;
export const MAX_AUTOMATION_ACTIONS = 10;
export const MAX_AUTOMATION_CONDITIONS = 10;
export const MAX_AUTOMATION_ATTEMPTS = 3;
export const MAX_AUTOMATION_RETRY_DELAY_SECONDS = 3600;

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

const CONDITION_FIELDS: readonly AutomationConditionField[] = [
  "event.type",
  "task.status",
  "task.priority",
  "task.title",
  "task.overdue",
  "task.ageDays",
  "project.status",
  "project.name",
  "project.ageDays",
];

const CONDITION_OPERATORS: readonly AutomationConditionOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gte",
  "lte",
  "is_true",
  "is_false",
];

const ACTION_TYPES: readonly AutomationActionType[] = [
  "create_task",
  "status_check",
  "summary",
  "notify",
  "task_reminder",
];

const PRIORITIES = ["low", "medium", "high"] as const;

const DRAFT_KEYS = [
  "actions",
  "conditions",
  "description",
  "maxActions",
  "maxAttempts",
  "name",
  "retryDelaySeconds",
  "trigger",
];

const TRIGGER_KEYS = [
  "dayOfMonth",
  "dayOfWeek",
  "eventType",
  "interval",
  "time",
  "type",
];

const CONDITION_KEYS = ["field", "operator", "value"];

const ACTION_KEYS = [
  "assignee",
  "description",
  "expectedStatus",
  "filter",
  "id",
  "limit",
  "message",
  "name",
  "priority",
  "projectId",
  "projectName",
  "resource",
  "taskId",
  "taskTitle",
  "title",
  "type",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): AutomationError {
  return new AutomationError(400, "VALIDATION_FAILED", message);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalid(`${label} contains an unsupported field: ${key}.`);
    }
  }
}

function requireString(
  value: unknown,
  label: string,
  max: number
): string {
  if (typeof value !== "string") throw invalid(`${label} must be a string.`);
  const trimmed = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!trimmed || trimmed.length > max) {
    throw invalid(`${label} must be between 1 and ${max} characters.`);
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  label: string,
  max: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(`${label} must be a string.`);
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (cleaned.length > max) {
    throw invalid(`${label} must not exceed ${max} characters.`);
  }
  return cleaned;
}

function requireInteger(
  value: unknown,
  label: string,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalid(`${label} must be a whole number.`);
  }
  if (value < min || value > max) {
    throw invalid(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalid(`${label} is not supported.`);
  }
  return value as T;
}

function normalizeTime(value: unknown): string {
  const time = requireString(value, "trigger.time", 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw invalid("trigger.time must use HH:MM in 24-hour time.");
  }
  return time;
}

export function normalizeTriggerConfig(value: unknown): AutomationTriggerConfig {
  if (!isRecord(value)) throw invalid("trigger must be an object.");
  assertKeys(value, TRIGGER_KEYS, "trigger");
  const type = requireEnum(value.type, TRIGGER_TYPES, "trigger.type");

  if (type === "manual") {
    return { type };
  }

  if (type === "event") {
    return {
      type,
      eventType: requireEnum(value.eventType, EVENT_TYPES, "trigger.eventType"),
    };
  }

  const interval = requireEnum(
    value.interval,
    ["daily", "weekly", "monthly"] as const,
    "trigger.interval"
  );
  const time = normalizeTime(value.time);
  if (interval === "weekly") {
    return {
      type,
      interval,
      time,
      dayOfWeek: requireInteger(value.dayOfWeek, "trigger.dayOfWeek", 0, 6),
    };
  }
  if (interval === "monthly") {
    return {
      type,
      interval,
      time,
      dayOfMonth: requireInteger(value.dayOfMonth, "trigger.dayOfMonth", 1, 31),
    };
  }
  return { type, interval, time };
}

function normalizeConditionValue(
  value: unknown,
  operator: AutomationConditionOperator
): string | number | boolean | undefined {
  if (operator === "is_true" || operator === "is_false") {
    if (value !== undefined) {
      throw invalid(`${operator} conditions must not include a value.`);
    }
    return undefined;
  }
  if (operator === "gte" || operator === "lte") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw invalid(`${operator} conditions require a numeric value.`);
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return requireString(value, "condition.value", SHORT_TEXT_MAX);
}

export function normalizeCondition(value: unknown): AutomationCondition {
  if (!isRecord(value)) throw invalid("Each condition must be an object.");
  assertKeys(value, CONDITION_KEYS, "condition");
  const field = requireEnum(
    value.field,
    CONDITION_FIELDS,
    "condition.field"
  );
  const operator = requireEnum(
    value.operator,
    CONDITION_OPERATORS,
    "condition.operator"
  );
  return {
    field,
    operator,
    ...(value.value !== undefined
      ? { value: normalizeConditionValue(value.value, operator) }
      : {}),
  };
}

function normalizeFilter(value: unknown): { readonly status?: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalid("action.filter must be an object.");
  assertKeys(value, ["status"], "action.filter");
  if (value.status === undefined) return {};
  return { status: requireString(value.status, "action.filter.status", SHORT_TEXT_MAX) };
}

export function normalizeAction(value: unknown): AutomationAction {
  if (!isRecord(value)) throw invalid("Each action must be an object.");
  assertKeys(value, ACTION_KEYS, "action");
  const type = requireEnum(value.type, ACTION_TYPES, "action.type");

  const common = {
    ...(value.title !== undefined
      ? { title: requireString(value.title, "action.title", TITLE_MAX) }
      : {}),
    ...(value.description !== undefined
      ? { description: requireString(value.description, "action.description", MESSAGE_MAX) }
      : {}),
    ...(value.priority !== undefined
      ? { priority: requireEnum(value.priority, PRIORITIES, "action.priority") }
      : {}),
    ...(value.assignee !== undefined
      ? { assignee: requireString(value.assignee, "action.assignee", SHORT_TEXT_MAX) }
      : {}),
    ...(value.projectId !== undefined
      ? { projectId: requireString(value.projectId, "action.projectId", 200) }
      : {}),
    ...(value.projectName !== undefined
      ? { projectName: requireString(value.projectName, "action.projectName", NAME_MAX) }
      : {}),
    ...(value.resource !== undefined
      ? {
          resource: requireEnum(
            value.resource,
            ["task", "project"] as const,
            "action.resource"
          ),
        }
      : {}),
    ...(value.id !== undefined
      ? { id: requireString(value.id, "action.id", 200) }
      : {}),
    ...(value.name !== undefined
      ? { name: requireString(value.name, "action.name", NAME_MAX) }
      : {}),
    ...(value.expectedStatus !== undefined
      ? {
          expectedStatus: requireString(
            value.expectedStatus,
            "action.expectedStatus",
            SHORT_TEXT_MAX
          ),
        }
      : {}),
    ...(value.message !== undefined
      ? { message: requireString(value.message, "action.message", MESSAGE_MAX) }
      : {}),
    ...(value.taskId !== undefined
      ? { taskId: requireString(value.taskId, "action.taskId", 200) }
      : {}),
    ...(value.taskTitle !== undefined
      ? { taskTitle: requireString(value.taskTitle, "action.taskTitle", TITLE_MAX) }
      : {}),
    ...(value.filter !== undefined ? { filter: normalizeFilter(value.filter) } : {}),
    ...(value.limit !== undefined
      ? { limit: requireInteger(value.limit, "action.limit", 1, 20) }
      : {}),
  };

  const action = { type, ...common } as AutomationAction;

  if (type === "create_task") {
    if (!action.title) throw invalid("create_task requires a title.");
    if (!action.projectId && !action.projectName) {
      throw invalid("create_task requires projectId or projectName.");
    }
    return action;
  }

  if (type === "status_check" || type === "summary") {
    if (!action.resource) throw invalid(`${type} requires a resource.`);
    if (type === "status_check" && !action.id && !action.name) {
      throw invalid("status_check requires id or name.");
    }
    return action;
  }

  if (type === "notify") {
    if (!action.message) throw invalid("notify requires a message.");
    return action;
  }

  if (!action.taskId && !action.taskTitle) {
    throw invalid("task_reminder requires taskId or taskTitle.");
  }
  return action;
}

export function normalizeWorkflowDraft(value: unknown): AutomationWorkflowDraft {
  if (!isRecord(value)) throw invalid("Workflow draft must be an object.");
  assertKeys(value, DRAFT_KEYS, "workflow draft");

  const name = requireString(value.name, "name", NAME_MAX);
  const description =
    optionalText(value.description, "description", DESCRIPTION_MAX) ?? "";
  const trigger = normalizeTriggerConfig(value.trigger);

  if (!Array.isArray(value.conditions) || value.conditions.length > MAX_AUTOMATION_CONDITIONS) {
    throw invalid(
      `conditions must be an array with at most ${MAX_AUTOMATION_CONDITIONS} entries.`
    );
  }
  if (!Array.isArray(value.actions) || value.actions.length < 1) {
    throw invalid("actions must contain at least one action.");
  }
  if (value.actions.length > MAX_AUTOMATION_ACTIONS) {
    throw invalid(`actions must contain at most ${MAX_AUTOMATION_ACTIONS} entries.`);
  }

  const conditions = value.conditions.map(normalizeCondition);
  const actions = value.actions.map(normalizeAction);

  const maxActions =
    value.maxActions === undefined
      ? actions.length
      : requireInteger(value.maxActions, "maxActions", 1, MAX_AUTOMATION_ACTIONS);
  if (actions.length > maxActions) {
    throw invalid("actions exceeds maxActions.");
  }

  return {
    name,
    description,
    trigger,
    conditions,
    actions,
    maxActions,
    maxAttempts:
      value.maxAttempts === undefined
        ? 1
        : requireInteger(
            value.maxAttempts,
            "maxAttempts",
            1,
            MAX_AUTOMATION_ATTEMPTS
          ),
    retryDelaySeconds:
      value.retryDelaySeconds === undefined
        ? 60
        : requireInteger(
            value.retryDelaySeconds,
            "retryDelaySeconds",
            0,
            MAX_AUTOMATION_RETRY_DELAY_SECONDS
          ),
  };
}

export function validateWorkflowDraft(value: unknown): readonly string[] {
  try {
    normalizeWorkflowDraft(value);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Workflow draft is invalid."];
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
