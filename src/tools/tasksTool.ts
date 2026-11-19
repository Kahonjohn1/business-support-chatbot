import type { ToolDefinition } from "@/lib/toolCalling";
import type {
  StructuredToolOutput,
  ToolExecutionContext,
  ToolMetadata,
} from "@/tools/registry";
import { findNameMatches } from "@/lib/resourceMatching";
import {
  resolveProjectReference,
  parseProjectReference,
  type ProjectReference,
} from "@/tools/projectStatusTool";
import {
  toProjectChoice,
  type ProjectResolution,
  type ProjectStatus,
} from "@/tools/projectData";
import {
  createTask,
  getTasksForProject,
  DEMO_TASK_NOTICE,
  type ProjectTask,
} from "@/tools/taskData";
import {
  beginApprovalExecution,
  createApprovalRequest,
  getApprovalRequest,
  markApprovalExecuted,
  markApprovalFailed,
} from "@/lib/approvalWorkflow";

export const CREATE_PROJECT_TASK_TOOL_NAME = "create_project_task";
export const LIST_PROJECT_TASKS_TOOL_NAME = "list_project_tasks";

export const CREATE_PROJECT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_PROJECT_TASK_TOOL_NAME,
    description:
      "Create a new task in a Marque Technologies project by its business name. This is a protected write operation requiring explicit user approval. Returns a sample demo record.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "The project's business name, for example Business Support Chatbot. Use list_projects first if the name is unclear.",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Clear, concise title for the task (max 100 characters).",
        },
        description: {
          type: "string",
          maxLength: 500,
          description:
            "Detailed description of the task requirements (max 500 characters).",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Task priority level. Defaults to medium.",
        },
        assignee: {
          type: "string",
          maxLength: 50,
          description:
            "Name of the person or team assigned (max 50 characters).",
        },
      },
      required: ["projectName", "title"],
      additionalProperties: false,
    },
  },
};

export const LIST_PROJECT_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_PROJECT_TASKS_TOOL_NAME,
    description:
      "List tasks associated with a Marque Technologies project by its business name. Optionally find a specific task by title. Returns demo/sample data.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "The project's business name, for example Business Support Chatbot.",
        },
        taskName: {
          type: "string",
          maxLength: 120,
          description:
            "Optional task title or title fragment to find a specific task.",
        },
      },
      required: ["projectName"],
      additionalProperties: false,
    },
  },
};

export const CREATE_PROJECT_TASK_METADATA: ToolMetadata = {
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
};

export const LIST_PROJECT_TASKS_METADATA: ToolMetadata = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
  requiresApproval: false,
};

const MAX_ARG_LENGTH = 2000;
const MAX_TASK_NAME_CHARS = 120;
const CREATE_TASK_KEYS = new Set([
  "projectName",
  "projectId",
  "title",
  "description",
  "priority",
  "assignee",
]);
const LIST_TASK_KEYS = new Set(["projectName", "projectId", "taskName"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidArguments(message: string): StructuredToolOutput {
  return {
    ok: false,
    error: { code: "INVALID_ARGUMENTS", message },
  };
}

function executionFailed(message: string): StructuredToolOutput {
  return {
    ok: false,
    error: { code: "EXECUTION_FAILED", message },
  };
}

function rejectUnknownKeys(
  parsed: Record<string, unknown>,
  allowed: ReadonlySet<string>
): void {
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown argument "${key}".`);
    }
  }
}

function projectReferenceFromRecord(
  parsed: Record<string, unknown>
): ProjectReference {
  const hasName = "projectName" in parsed;
  const hasId = "projectId" in parsed;
  if (hasName === hasId) {
    throw new Error("Provide exactly one of projectName or projectId.");
  }

  const key = hasName ? "projectName" : "projectId";
  return parseProjectReference(JSON.stringify({ [key]: parsed[key] }));
}

function parseOptionalTaskName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("taskName must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TASK_NAME_CHARS) {
    throw new Error("taskName must not exceed 120 characters.");
  }
  return trimmed || undefined;
}

interface CreateTaskParams {
  projectReference: ProjectReference;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  assignee?: string;
}

interface ListTaskParams {
  projectReference: ProjectReference;
  taskName?: string;
}

function parseCreateTaskArguments(raw: string): CreateTaskParams {
  if (typeof raw !== "string" || raw.length > MAX_ARG_LENGTH) {
    throw new Error("Invalid tool arguments length.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  rejectUnknownKeys(parsed, CREATE_TASK_KEYS);
  const projectReference = projectReferenceFromRecord(parsed);

  const title = parsed.title;
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("title must be a non-empty string.");
  }
  const normalizedTitle = title.trim();
  if (normalizedTitle.length > 100) {
    throw new Error("title must not exceed 100 characters.");
  }

  let description: string | undefined;
  if ("description" in parsed && parsed.description !== undefined) {
    if (typeof parsed.description !== "string") {
      throw new Error("description must be a string.");
    }
    const normalizedDescription = parsed.description.trim();
    if (normalizedDescription.length > 500) {
      throw new Error("description must not exceed 500 characters.");
    }
    description = normalizedDescription || undefined;
  }

  let priority: "low" | "medium" | "high" = "medium";
  if ("priority" in parsed && parsed.priority !== undefined) {
    if (
      parsed.priority !== "low" &&
      parsed.priority !== "medium" &&
      parsed.priority !== "high"
    ) {
      throw new Error("priority must be 'low', 'medium', or 'high'.");
    }
    priority = parsed.priority;
  }

  let assignee: string | undefined;
  if ("assignee" in parsed && parsed.assignee !== undefined) {
    if (typeof parsed.assignee !== "string") {
      throw new Error("assignee must be a string.");
    }
    const normalizedAssignee = parsed.assignee.trim();
    if (normalizedAssignee.length > 50) {
      throw new Error("assignee must not exceed 50 characters.");
    }
    assignee = normalizedAssignee || undefined;
  }

  return {
    projectReference,
    title: normalizedTitle,
    description,
    priority,
    assignee,
  };
}

function parseListTaskArguments(raw: string): ListTaskParams {
  if (typeof raw !== "string" || raw.length > MAX_ARG_LENGTH) {
    throw new Error("Invalid tool arguments length.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  rejectUnknownKeys(parsed, LIST_TASK_KEYS);

  return {
    projectReference: projectReferenceFromRecord(parsed),
    taskName: parseOptionalTaskName(parsed.taskName),
  };
}

function unresolvedProjectData(
  resolution: ProjectResolution,
  reference: ProjectReference
): Record<string, unknown> {
  if (resolution.status === "ambiguous") {
    return {
      status: "needs_clarification",
      resource: "project",
      ...(reference.kind === "name" ? { projectName: reference.value } : {}),
      choices: resolution.matches.map(toProjectChoice),
      sampleData: true,
      message:
        "More than one project matches that name. Ask the user which project they mean.",
      notice: DEMO_TASK_NOTICE,
    };
  }

  return {
    status: "not_found",
    resource: "project",
    ...(reference.kind === "name" ? { projectName: reference.value } : {}),
    sampleData: true,
    message:
      "No matching project was found in the demo/sample dataset. Do not invent project details.",
    notice: DEMO_TASK_NOTICE,
  };
}

function taskDetails(task: ProjectTask) {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    createdAt: task.createdAt,
    sampleData: true as const,
  };
}

function taskChoice(task: ProjectTask) {
  return {
    title: task.title,
    status: task.status,
    assignee: task.assignee,
  };
}

function approvalMatchesCreateTask(
  approval: { toolName: string; rawArguments: string },
  params: CreateTaskParams,
  project: ProjectStatus
): boolean {
  if (approval.toolName !== CREATE_PROJECT_TASK_TOOL_NAME) {
    return false;
  }

  try {
    const approved = parseCreateTaskArguments(approval.rawArguments);
    const approvedResolution = resolveProjectReference(
      approved.projectReference
    );
    if (
      approvedResolution.status !== "resolved" ||
      approvedResolution.project.projectId !== project.projectId
    ) {
      return false;
    }

    return (
      approved.title === params.title &&
      (approved.description ?? "") === (params.description ?? "") &&
      approved.priority === params.priority &&
      (approved.assignee ?? "") === (params.assignee ?? "")
    );
  } catch {
    return false;
  }
}

function executedTaskData(task: ProjectTask, project: ProjectStatus) {
  return {
    status: "executed" as const,
    sampleData: true as const,
    notice: DEMO_TASK_NOTICE,
    projectName: project.name,
    task: taskDetails(task),
  };
}

function executeApprovedCreateTask(
  params: CreateTaskParams,
  project: ProjectStatus,
  approvalId: string,
  context: ToolExecutionContext
): StructuredToolOutput {
  const approval = getApprovalRequest(approvalId);
  if (!approval) {
    return invalidArguments("The approval request was not found or has expired.");
  }

  if (approval.status === "executed" && isRecord(approval.executionResult)) {
    return {
      ok: true,
      data: approval.executionResult,
    };
  }

  if (approval.status !== "approved") {
    return executionFailed(
      "This operation can no longer be executed because its approval is not active."
    );
  }

  if (approval.toolName !== CREATE_PROJECT_TASK_TOOL_NAME) {
    return invalidArguments("The approval is not valid for this operation.");
  }

  if (approval.requestId !== context.requestId) {
    return invalidArguments("The approval is not valid for this request.");
  }

  if (!approvalMatchesCreateTask(approval, params, project)) {
    return invalidArguments(
      "The approval does not match the requested task details."
    );
  }

  try {
    beginApprovalExecution(approval.id);
  } catch {
    return executionFailed("The approval could not be executed.");
  }

  let task: ProjectTask;
  try {
    task = createTask({
      projectId: project.projectId,
      title: params.title,
      description: params.description,
      priority: params.priority,
      assignee: params.assignee,
    });
  } catch (error) {
    markApprovalFailed(
      approval.id,
      error instanceof Error ? error.message : "Task creation failed."
    );
    return executionFailed("The approved task could not be created.");
  }

  const data = executedTaskData(task, project);
  try {
    markApprovalExecuted(approval.id, data);
  } catch {}

  return { ok: true, data };
}

/**
 * Executes the create_project_task tool.
 * Proposes the operation for approval. Execution is only possible when the
 * server-supplied execution context carries a verified approval capability.
 */
export function executeCreateProjectTask(
  rawArguments: string,
  context: ToolExecutionContext
): StructuredToolOutput {
  let params: CreateTaskParams;
  try {
    params = parseCreateTaskArguments(rawArguments);
  } catch (error) {
    return invalidArguments(
      error instanceof Error ? error.message : "Invalid tool arguments."
    );
  }

  const resolution = resolveProjectReference(params.projectReference);
  if (resolution.status !== "resolved") {
    return {
      ok: true,
      data: unresolvedProjectData(resolution, params.projectReference),
    };
  }

  const project = resolution.project;
  const approvalId = context.approvalId?.trim();
  if (approvalId) {
    return executeApprovedCreateTask(params, project, approvalId, context);
  }

  const summary = `Create ${params.priority} priority task "${params.title}" in project "${project.name}"`;
  try {
    const approval = createApprovalRequest({
      requestId: context.requestId,
      toolName: CREATE_PROJECT_TASK_TOOL_NAME,
      rawArguments,
      summary,
      details: {
        projectName: project.name,
        title: params.title,
        description: params.description ?? "",
        priority: params.priority,
        assignee: params.assignee ?? "Unassigned",
      },
    });

    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: CREATE_PROJECT_TASK_TOOL_NAME,
        summary,
        sampleData: true,
        notice:
          "This operation requires explicit user approval before execution.",
        details: approval.details,
      },
    };
  } catch {
    return executionFailed("The approval request could not be created.");
  }
}

/**
 * Executes the list_project_tasks tool.
 */
export function executeListProjectTasks(
  rawArguments: string
): StructuredToolOutput {
  let params: ListTaskParams;
  try {
    params = parseListTaskArguments(rawArguments);
  } catch (error) {
    return invalidArguments(
      error instanceof Error ? error.message : "Invalid tool arguments."
    );
  }

  const resolution = resolveProjectReference(params.projectReference);
  if (resolution.status !== "resolved") {
    return {
      ok: true,
      data: unresolvedProjectData(resolution, params.projectReference),
    };
  }

  const project = resolution.project;
  let tasks = getTasksForProject(project.projectId);

  if (params.taskName) {
    const matches = findNameMatches(
      params.taskName,
      tasks,
      (task) => task.title
    );

    if (matches.length === 0) {
      return {
        ok: true,
        data: {
          status: "not_found",
          resource: "task",
          projectName: project.name,
          taskName: params.taskName,
          choices: [],
          tasks: [],
          totalTasks: 0,
          sampleData: true,
          message:
            "No matching task was found for that project in the demo/sample dataset.",
          notice: DEMO_TASK_NOTICE,
        },
      };
    }

    if (matches.length > 1) {
      return {
        ok: true,
        data: {
          status: "needs_clarification",
          resource: "task",
          projectName: project.name,
          taskName: params.taskName,
          choices: matches.map(taskChoice),
          sampleData: true,
          message:
            "More than one task matches that name. Ask the user which task they mean.",
          notice: DEMO_TASK_NOTICE,
        },
      };
    }

    tasks = matches;
  }

  return {
    ok: true,
    data: {
      status: "ok",
      projectName: project.name,
      ...(params.taskName ? { taskName: params.taskName } : {}),
      tasks: tasks.map(taskDetails),
      totalTasks: tasks.length,
      sampleData: true,
      notice: DEMO_TASK_NOTICE,
    },
  };
}
