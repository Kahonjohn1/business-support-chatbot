import type {
  AutomationAction,
  AutomationCondition,
  AutomationEventType,
  AutomationTriggerConfig,
  AutomationWorkflowDraft,
  AutomationWorkflowProposal,
} from "@/lib/automation/types";
import { normalizeWorkflowDraft, validateWorkflowDraft } from "@/lib/automation/validation";

const DESCRIPTION_MAX = 500;
const NAME_MAX = 120;
const DAY_NAMES: Readonly<Record<string, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function parseTime(text: string): string | undefined {
  const numeric = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (numeric) {
    return `${numeric[1].padStart(2, "0")}:${numeric[2]}`;
  }
  const twelveHour = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (!twelveHour) return undefined;
  let hour = Number(twelveHour[1]);
  if (hour < 1 || hour > 12) return undefined;
  if (twelveHour[2].toLowerCase() === "pm" && hour < 12) hour += 12;
  if (twelveHour[2].toLowerCase() === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:00`;
}

function parseTrigger(text: string): AutomationTriggerConfig | null {
  if (includesAny(text, ["run manually", "when i run it manually", "on demand"])) {
    return { type: "manual" };
  }

  const eventPatterns: readonly {
    readonly phrases: readonly string[];
    readonly eventType: AutomationEventType;
  }[] = [
    { phrases: ["task is created", "new task", "task created"], eventType: "task.created" },
    { phrases: ["task is updated", "task changes", "task updated"], eventType: "task.updated" },
    { phrases: ["task is overdue", "overdue task", "task becomes overdue"], eventType: "task.overdue" },
    {
      phrases: ["project is created", "new project", "project created"],
      eventType: "project.created",
    },
    {
      phrases: ["project is updated", "project changes", "project updated"],
      eventType: "project.updated",
    },
  ];
  for (const pattern of eventPatterns) {
    if (includesAny(text, pattern.phrases)) {
      return { type: "event", eventType: pattern.eventType };
    }
  }

  const time = parseTime(text) ?? "09:00";
  for (const [dayName, dayOfWeek] of Object.entries(DAY_NAMES)) {
    if (text.includes(`every ${dayName}`) || text.includes(`on ${dayName}s`)) {
      return { type: "schedule", interval: "weekly", time, dayOfWeek };
    }
  }
  if (includesAny(text, ["every month", "monthly"])) {
    const dayMatch = text.match(/\bday\s+(\d{1,2})\b/i);
    const dayOfMonth = dayMatch
      ? Math.max(1, Math.min(31, Number(dayMatch[1])))
      : 1;
    return { type: "schedule", interval: "monthly", time, dayOfMonth };
  }
  if (includesAny(text, ["every day", "daily", "each morning", "every morning"])) {
    return { type: "schedule", interval: "daily", time };
  }
  if (includesAny(text, ["every week", "weekly"])) {
    return { type: "schedule", interval: "weekly", time, dayOfWeek: 1 };
  }
  return null;
}

function parseConditions(text: string): AutomationCondition[] {
  const conditions: AutomationCondition[] = [];
  const add = (condition: AutomationCondition) => {
    if (!conditions.some((existing) => JSON.stringify(existing) === JSON.stringify(condition))) {
      conditions.push(condition);
    }
  };
  if (includesAny(text, ["high priority", "priority is high"])) {
    add({ field: "task.priority", operator: "equals", value: "high" });
  }
  if (includesAny(text, ["blocked", "is blocked"])) {
    add({ field: "project.status", operator: "equals", value: "blocked" });
  }
  if (includesAny(text, ["completed", "is completed"])) {
    add({ field: "project.status", operator: "equals", value: "completed" });
  }
  if (includesAny(text, ["overdue", "past due"])) {
    add({ field: "task.overdue", operator: "is_true" });
  }
  return conditions;
}

function parseActions(text: string): AutomationAction[] {
  const actions: AutomationAction[] = [];
  const add = (action: AutomationAction) => {
    if (actions.length < 10) actions.push(action);
  };

  if (includesAny(text, ["create a task", "create a follow-up task", "create follow-up task"])) {
    add({
      type: "create_task",
      title: "Follow up on {{task.title}}",
      description: "Automated follow-up created by an approved automation.",
      projectId: "{{project.id}}",
      priority: "medium",
    });
  }
  if (includesAny(text, ["summar", "summary"])) {
    add({ type: "summary", resource: "task", limit: 10 });
    add({ type: "notify", message: "Task summary: {{summary}}" });
  }
  if (includesAny(text, ["remind", "reminder"])) {
    add({
      type: "task_reminder",
      taskTitle: "{{task.title}}",
      message: "Reminder: {{task.title}} is still open.",
    });
  }
  if (includesAny(text, ["notify me", "alert me", "notification"])) {
    if (!actions.some((action) => action.type === "notify")) {
      add({ type: "notify", message: "Automation check completed: {{summary}}" });
    }
  }
  if (includesAny(text, ["check status", "status check"])) {
    add({ type: "status_check", resource: "project", name: "{{project.name}}" });
  }
  return actions;
}

function describeTrigger(trigger: AutomationTriggerConfig): string {
  if (trigger.type === "manual") return "Runs only when you start it manually.";
  if (trigger.type === "event") {
    return `Runs when ${trigger.eventType?.replace(".", " ")} occurs.`;
  }
  if (trigger.interval === "daily") return `Runs daily at ${trigger.time}.`;
  if (trigger.interval === "weekly") {
    const day =
      Object.entries(DAY_NAMES).find(([, value]) => value === trigger.dayOfWeek)?.[0] ??
      "monday";
    return `Runs every ${day} at ${trigger.time}.`;
  }
  return `Runs on day ${trigger.dayOfMonth ?? 1} of each month at ${trigger.time}.`;
}

function describeCondition(condition: AutomationCondition): string {
  const value =
    condition.value === undefined ? "" : ` ${String(condition.value)}`.trim();
  return `Only continue when ${condition.field} ${condition.operator}${value}.`;
}

function describeAction(action: AutomationAction): string {
  if (action.type === "create_task") return `Create task "${action.title}".`;
  if (action.type === "status_check") return `Check ${action.resource} status.`;
  if (action.type === "summary") return `Build a bounded ${action.resource} summary.`;
  if (action.type === "notify") return `Store an in-app notification: ${action.message}`;
  return `Create a reminder for ${action.taskTitle ?? action.taskId}.`;
}

export function proposeAutomationWorkflow(value: unknown): AutomationWorkflowProposal {
  if (!isRecord(value) || typeof value.description !== "string") {
    return {
      ok: false,
      name: "",
      description: "",
      draft: null,
      explanation: [],
      missingDetails: ["A workflow description is required."],
    };
  }

  const description = cleanText(value.description).slice(0, DESCRIPTION_MAX);
  if (!description) {
    return {
      ok: false,
      name: "",
      description: "",
      draft: null,
      explanation: [],
      missingDetails: ["A workflow description is required."],
    };
  }

  const requestedName =
    typeof value.name === "string" ? cleanText(value.name).slice(0, NAME_MAX) : "";
  const name = requestedName || `Automation for ${description.slice(0, 60)}`;

  const trigger = parseTrigger(description.toLowerCase());
  const conditions = parseConditions(description.toLowerCase());
  const actions = parseActions(description.toLowerCase());
  const missingDetails: string[] = [];
  if (!trigger) {
    missingDetails.push(
      "Add a schedule (for example, every Monday at 9am), an event (for example, when a task is created), or manual execution."
    );
  }
  if (actions.length === 0) {
    missingDetails.push(
      "Add a supported action: create a task, check status, summarize tasks, remind me, or notify me."
    );
  }

  const explanation = trigger ? [describeTrigger(trigger)] : [];
  explanation.push(...conditions.map(describeCondition));
  explanation.push(...actions.map(describeAction));
  explanation.push(
    "No arbitrary code, SQL, shell commands, or external email/calendar sending is executed."
  );

  if (missingDetails.length > 0 || !trigger) {
    return {
      ok: false,
      name,
      description,
      draft: null,
      explanation,
      missingDetails,
    };
  }

  const candidate: AutomationWorkflowDraft = {
    name,
    description,
    trigger,
    conditions,
    actions,
    maxActions: actions.length,
    maxAttempts: 1,
    retryDelaySeconds: 60,
  };
  const errors = validateWorkflowDraft(candidate);
  if (errors.length > 0) {
    return { ok: false, name, description, draft: null, explanation, missingDetails: errors };
  }

  const draft = normalizeWorkflowDraft(candidate);
  return {
    ok: true,
    name: draft.name,
    description: draft.description,
    draft,
    explanation: [
      ...explanation,
      "Saving this workflow through chat requires your explicit approval.",
    ],
    missingDetails: [],
  };
}
