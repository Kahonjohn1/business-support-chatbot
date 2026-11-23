import type { ToolDefinition } from "@/lib/toolCalling";
import type {
  StructuredToolOutput,
  ToolExecutionContext,
  ToolMetadata,
} from "@/tools/registry";
import { findNameMatches } from "@/lib/resourceMatching";
import {
  personalUserIdFromAuth,
  type PersonalProjectRecord,
  type PersonalTaskRecord,
} from "@/lib/personalProjectData";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import {
  createWorkspaceTask,
  listWorkspaceTasks,
  updateWorkspaceTask,
  verifiedWorkspaceIdFromAuth,
} from "@/lib/workspace/workspaceProjectData";
import {
  resolveProjectReference,
  parseProjectReference,
  type ProjectReference,
} from "@/tools/projectStatusTool";
import {
  beginApprovalExecutionRecord,
  completeApprovalExecutionRecord,
  createApprovalRecord,
  failApprovalExecutionRecord,
  getApprovalRecord,
} from "@/lib/approvalWorkflow";
import { dispatchTaskMutation } from "@/lib/automation/dispatch";

export const CREATE_PROJECT_TASK_TOOL_NAME = "create_project_task";
export const UPDATE_PROJECT_TASK_TOOL_NAME = "update_project_task";
export const LIST_PROJECT_TASKS_TOOL_NAME = "list_project_tasks";

export const CREATE_PROJECT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_PROJECT_TASK_TOOL_NAME,
    description:
      "Create a task in one of the signed-in user's personal projects by its name. Protected action requiring explicit user approval before any record is written.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "The project's name, for example Website Redesign. Use list_projects first if the name is unclear.",
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
            "Personal-only assignee name (max 50 characters). Do not combine with assigneeId.",
        },
        assigneeId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description:
            "Active business-workspace member ID to assign. Do not combine with assignee.",
        },
      },
      required: ["projectName", "title"],
      additionalProperties: false,
    },
  },
};

export const UPDATE_PROJECT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: UPDATE_PROJECT_TASK_TOOL_NAME,
    description:
      "Update the title, description, priority, status, or assignee of a task in a named project in the active workspace. Protected action requiring explicit user approval before any record is changed.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "The project that contains the task.",
        },
        taskName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "The task's current title. Use list_project_tasks first if unclear.",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "New task title. Omit to leave it unchanged.",
        },
        description: {
          type: "string",
          maxLength: 500,
          description: "New task description. Omit to leave it unchanged.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "New task priority. Omit to leave it unchanged.",
        },
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done"],
          description: "New task status. Omit to leave it unchanged.",
        },
        assignee: {
          type: "string",
          maxLength: 50,
          description:
            "New personal-only assignee name. Do not combine with assigneeId.",
        },
        assigneeId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description:
            "New active business-workspace member ID. Use an empty string to unassign. Do not combine with assignee.",
        },
      },
      required: ["projectName", "taskName"],
      additionalProperties: false,
    },
  },
};

export const LIST_PROJECT_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_PROJECT_TASKS_TOOL_NAME,
    description:
      "List tasks in one of the signed-in user's personal projects by its name. Optionally find a specific task by title.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "The project's name, for example Website Redesign.",
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

export const UPDATE_PROJECT_TASK_METADATA: ToolMetadata = {
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
const MAX_ASSIGNEE_ID_CHARS = 200;
const CREATE_TASK_KEYS = new Set([
  "projectName",
  "projectId",
  "title",
  "description",
  "priority",
  "assignee",
  "assigneeId",
]);
const LIST_TASK_KEYS = new Set(["projectName", "projectId", "taskName"]);
const UPDATE_TASK_KEYS = new Set([
  "projectName",
  "projectId",
  "taskName",
  "title",
  "description",
  "priority",
  "status",
  "assignee",
  "assigneeId",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidArguments(message: string): StructuredToolOutput {
  return { ok: false, error: { code: "INVALID_ARGUMENTS", message } };
}

function executionFailed(message: string): StructuredToolOutput {
  return { ok: false, error: { code: "EXECUTION_FAILED", message } };
}

function permissionDenied(): StructuredToolOutput {
  return {
    ok: false,
    error: {
      code: "PERMISSION_DENIED",
      message: "A verified user identity is required for this operation.",
    },
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

function parseOptionalAssigneeId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error("assigneeId must be a string or null.");
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_ASSIGNEE_ID_CHARS) {
    throw new Error("assigneeId must not exceed 200 characters.");
  }
  return trimmed || null;
}

interface CreateTaskParams {
  projectReference: ProjectReference;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  assignee?: string;
  assigneeId?: string | null;
}

interface ListTaskParams {
  projectReference: ProjectReference;
  taskName?: string;
}

interface UpdateTaskParams {
  projectReference: ProjectReference;
  taskName: string;
  title?: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  status?: "todo" | "in_progress" | "done";
  assignee?: string;
  assigneeId?: string | null;
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

  const assigneeId = parseOptionalAssigneeId(parsed.assigneeId);
  if (assignee && assigneeId) {
    throw new Error("Provide at most one of assignee or assigneeId.");
  }

  return {
    projectReference,
    title: normalizedTitle,
    description,
    priority,
    assignee,
    assigneeId: assigneeId ?? undefined,
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

function requireTaskName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("taskName must be a string.");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TASK_NAME_CHARS) {
    throw new Error("taskName must be between 1 and 120 characters.");
  }
  return trimmed;
}

function parseUpdateTaskArguments(raw: string): UpdateTaskParams {
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
  rejectUnknownKeys(parsed, UPDATE_TASK_KEYS);

  const params: UpdateTaskParams = {
    projectReference: projectReferenceFromRecord(parsed),
    taskName: requireTaskName(parsed.taskName),
  };

  if ("title" in parsed && parsed.title !== undefined) {
    if (typeof parsed.title !== "string") {
      throw new Error("title must be a string.");
    }
    const title = parsed.title.trim();
    if (!title || title.length > 100) {
      throw new Error("title must be between 1 and 100 characters.");
    }
    params.title = title;
  }

  if ("description" in parsed && parsed.description !== undefined) {
    if (typeof parsed.description !== "string") {
      throw new Error("description must be a string.");
    }
    const description = parsed.description.trim();
    if (description.length > 500) {
      throw new Error("description must not exceed 500 characters.");
    }
    params.description = description;
  }

  if ("priority" in parsed && parsed.priority !== undefined) {
    if (
      parsed.priority !== "low" &&
      parsed.priority !== "medium" &&
      parsed.priority !== "high"
    ) {
      throw new Error("priority must be 'low', 'medium', or 'high'.");
    }
    params.priority = parsed.priority;
  }

  if ("status" in parsed && parsed.status !== undefined) {
    if (
      parsed.status !== "todo" &&
      parsed.status !== "in_progress" &&
      parsed.status !== "done"
    ) {
      throw new Error("status must be 'todo', 'in_progress', or 'done'.");
    }
    params.status = parsed.status;
  }

  if ("assignee" in parsed && parsed.assignee !== undefined) {
    if (typeof parsed.assignee !== "string") {
      throw new Error("assignee must be a string.");
    }
    const assignee = parsed.assignee.trim();
    if (assignee.length > 50) {
      throw new Error("assignee must not exceed 50 characters.");
    }
    params.assignee = assignee || "Unassigned";
  }

  const assigneeId = parseOptionalAssigneeId(parsed.assigneeId);
  if (params.assignee && assigneeId) {
    throw new Error("Provide at most one of assignee or assigneeId.");
  }
  if (assigneeId !== undefined) params.assigneeId = assigneeId;

  if (
    params.title === undefined &&
    params.description === undefined &&
    params.priority === undefined &&
    params.status === undefined &&
    params.assignee === undefined &&
    params.assigneeId === undefined
  ) {
    throw new Error("At least one field to update must be provided.");
  }

  return params;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function unresolvedProjectData(
  resolution: { status: "ambiguous"; matches: readonly PersonalProjectRecord[] } | {
    status: "not_found";
  },
  reference: ProjectReference
): Record<string, unknown> {
  if (resolution.status === "ambiguous") {
    return {
      status: "needs_clarification",
      resource: "project",
      ...(reference.kind === "name" ? { projectName: reference.value } : {}),
      choices: resolution.matches.map((project) => ({
        name: project.name,
        status: project.status,
      })),
      message:
        "More than one personal project matches that name. Ask the user which project they mean.",
    };
  }

  return {
    status: "not_found",
    resource: "project",
    ...(reference.kind === "name" ? { projectName: reference.value } : {}),
    message:
      "No matching personal project was found. Do not invent project details.",
  };
}

function taskDetails(task: PersonalTaskRecord) {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    createdAt: task.createdAt,
  };
}

function taskChoice(task: PersonalTaskRecord) {
  return {
    title: task.title,
    status: task.status,
    assignee: task.assignee,
  };
}

function isDatabaseFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "PersonalDataError" ||
      error.name === "WorkspaceProjectDataError" ||
      /personal project|workspace project|supabase|database|fetch failed/i.test(
        error.message
      ))
  );
}

function isAccessFailure(error: unknown): boolean {
  return error instanceof WorkspaceAccessError;
}

function authenticatedUserId(context: ToolExecutionContext): string | null {
  try {
    return personalUserIdFromAuth(context?.auth);
  } catch {
    return null;
  }
}

async function resolveOwnedProject(
  reference: ProjectReference,
  context: ToolExecutionContext
): Promise<
  | { status: "resolved"; project: PersonalProjectRecord }
  | { status: "ambiguous"; matches: readonly PersonalProjectRecord[] }
  | { status: "not_found" }
  | { status: "denied" }
> {
  if (!authenticatedUserId(context)) return { status: "denied" };
  try {
    return await resolveProjectReference(reference, context.auth);
  } catch (error) {
    throw error;
  }
}

async function approvalMatchesCreateTask(
  approval: {
    toolName: string;
    rawArguments: string;
    requestId: string;
    userId?: string;
    resourceId?: string;
    workspaceId?: string;
    workspaceKind?: "personal" | "shared";
    details: Readonly<Record<string, unknown>>;
  },
  params: CreateTaskParams,
  project: PersonalProjectRecord,
  rawArguments: string,
  context: ToolExecutionContext,
  workspaceId: string | undefined,
  workspaceKind: "personal" | "shared"
): Promise<boolean> {
  const userId = authenticatedUserId(context);
  if (!userId || approval.toolName !== CREATE_PROJECT_TASK_TOOL_NAME) {
    return false;
  }
  if (
    approval.userId !== userId ||
    approval.resourceId !== project.id ||
    approval.workspaceId !== workspaceId ||
    (approval.workspaceKind ?? workspaceKind) !== workspaceKind
  ) {
    return false;
  }
  if (canonicalJson(JSON.parse(approval.rawArguments)) !== canonicalJson(JSON.parse(rawArguments))) {
    return false;
  }

  try {
    const approved = parseCreateTaskArguments(approval.rawArguments);
    const approvedResolution = await resolveProjectReference(
      approved.projectReference,
      context.auth
    );
    if (
      approvedResolution.status !== "resolved" ||
      approvedResolution.project.id !== project.id
    ) {
      return false;
    }

    return (
      approved.title === params.title &&
      (approved.description ?? "") === (params.description ?? "") &&
      approved.priority === params.priority &&
      (approved.assignee ?? "") === (params.assignee ?? "") &&
      (approved.assigneeId ?? "") === (params.assigneeId ?? "") &&
      (approval.details.assigneeId ?? "") === (params.assigneeId ?? "")
    );
  } catch {
    return false;
  }
}

function executedTaskData(
  task: PersonalTaskRecord,
  project: PersonalProjectRecord
) {
  return {
    status: "executed" as const,
    projectName: project.name,
    task: taskDetails(task),
  };
}

async function executeApprovedCreateTask(
  params: CreateTaskParams,
  project: PersonalProjectRecord,
  approvalId: string,
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  const userId = authenticatedUserId(context);
  if (!userId) return permissionDenied();

  let workspaceId: string | undefined;
  try {
    workspaceId = await verifiedWorkspaceIdFromAuth(context.auth);
  } catch {
    return permissionDenied();
  }
  const workspaceKind = workspaceId ? "shared" : "personal";

  const approval = await getApprovalRecord(approvalId);
  if (!approval) {
    return invalidArguments("The approval request was not found or has expired.");
  }

  if (approval.status === "executed" && isRecord(approval.executionResult)) {
    if (
      approval.userId === userId &&
      approval.workspaceId === workspaceId &&
      (approval.workspaceKind ?? workspaceKind) === workspaceKind &&
      approval.executionResult.status === "executed"
    ) {
      return { ok: true, data: approval.executionResult };
    }
    return permissionDenied();
  }

  if (approval.userId !== userId) {
    return permissionDenied();
  }

  if (approval.status !== "approved") {
    return executionFailed(
      "This operation can no longer be executed because its approval is not active."
    );
  }

  if (approval.requestId !== context.requestId) {
    return invalidArguments("The approval is not valid for this request.");
  }

  let matches: boolean;
  try {
    matches = await approvalMatchesCreateTask(
      approval,
      params,
       project,
       rawArguments,
        context,
        workspaceId,
        workspaceKind
      );

  } catch {
    return invalidArguments("The approval does not match the requested task details.");
  }
  if (!matches) {
    return invalidArguments(
      "The approval does not match the requested task details."
    );
  }

  try {
    await beginApprovalExecutionRecord(approval.id);
  } catch {
    return executionFailed("The approval could not be executed.");
  }

  let task: PersonalTaskRecord;
  try {
    task = await createWorkspaceTask(context.auth, {
      projectId: project.id,
      title: params.title,
      description: params.description,
      priority: params.priority,
      assignee: params.assignee,
      assigneeId: params.assigneeId,
    });
  } catch (error) {
    await failApprovalExecutionRecord(
      approval.id,
      error instanceof Error ? error.message : "Task creation failed."
    );
    return executionFailed("The approved task could not be created.");
  }
  await dispatchTaskMutation(context.auth, "task.created", task);

  const data = executedTaskData(task, project);
  try {
    await completeApprovalExecutionRecord(approval.id, data);
  } catch {
    const current = await getApprovalRecord(approval.id);
    if (current?.status !== "executed" || !isRecord(current.executionResult)) {
      return executionFailed("The approved task could not be confirmed.");
    }
    return { ok: true, data: current.executionResult };
  }

  return { ok: true, data };
}

export async function executeCreateProjectTask(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let params: CreateTaskParams;
  let workspaceId: string | undefined;
  try {
    const userId = personalUserIdFromAuth(context?.auth);
    if (!userId) return permissionDenied();
    params = parseCreateTaskArguments(rawArguments);
    workspaceId = await verifiedWorkspaceIdFromAuth(context.auth);
  } catch (error) {
    if (
      error instanceof WorkspaceAccessError ||
      (error instanceof Error && /verified user identity/i.test(error.message))
    ) {
      return permissionDenied();
    }
    return invalidArguments(
      error instanceof Error ? error.message : "Invalid tool arguments."
    );
  }
  const workspaceKind = workspaceId ? "shared" : "personal";

  const approvalId = context.approvalId?.trim();
  if (approvalId) {
    const approval = await getApprovalRecord(approvalId);
    if (!approval || approval.toolName !== CREATE_PROJECT_TASK_TOOL_NAME) {
      return invalidArguments("The approval request was not found or has expired.");
    }
    if (approval.userId !== personalUserIdFromAuth(context.auth)) {
      return permissionDenied();
    }
    if (approval.requestId !== context.requestId) {
      return invalidArguments("The approval is not valid for this request.");
    }
  }

  let resolution;
  try {
    resolution = await resolveOwnedProject(params.projectReference, context);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error)
      ? executionFailed("Personal project data is unavailable right now.")
      : invalidArguments(
          error instanceof Error ? error.message : "Invalid project reference."
        );
  }

  if (resolution.status === "denied") return permissionDenied();
  if (resolution.status !== "resolved") {
    return {
      ok: true,
      data: unresolvedProjectData(resolution, params.projectReference),
    };
  }

  const project = resolution.project;
  if (approvalId) {
    return executeApprovedCreateTask(
      params,
      project,
      approvalId,
      rawArguments,
      context
    );
  }

  const summary = `Create ${params.priority} priority task "${params.title}" in project "${project.name}"`;
  try {
    const approval = await createApprovalRecord({
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
        assigneeId: params.assigneeId ?? "",
      },
      userId: authenticatedUserId(context) ?? undefined,
      resourceId: project.id,
      workspaceId,
      workspaceKind,
    });

    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: CREATE_PROJECT_TASK_TOOL_NAME,
        summary,
        details: approval.details,
        notice:
          "This operation requires explicit user approval before execution.",
      },
    };
  } catch {
    return executionFailed("The approval request could not be created.");
  }
}

type UpdateTaskResolution =
  | { status: "resolved"; project: PersonalProjectRecord; task: PersonalTaskRecord }
  | { status: "project_unresolved"; result: { status: "ambiguous"; matches: readonly PersonalProjectRecord[] } | { status: "not_found" } }
  | { status: "task_ambiguous"; project: PersonalProjectRecord; matches: readonly PersonalTaskRecord[] }
  | { status: "task_not_found"; project: PersonalProjectRecord }
  | { status: "denied" };

async function resolveTaskForUpdate(
  params: UpdateTaskParams,
  context: ToolExecutionContext
): Promise<UpdateTaskResolution> {
  if (!authenticatedUserId(context)) return { status: "denied" };
  const projectResolution = await resolveProjectReference(
    params.projectReference,
    context.auth
  );
  if (projectResolution.status !== "resolved") {
    return { status: "project_unresolved", result: projectResolution };
  }
  const tasks = await listWorkspaceTasks(context.auth, projectResolution.project.id);
  const matches = findNameMatches(params.taskName, tasks, (task) => task.title);
  if (matches.length === 0) {
    return { status: "task_not_found", project: projectResolution.project };
  }
  if (matches.length > 1) {
    return {
      status: "task_ambiguous",
      project: projectResolution.project,
      matches,
    };
  }
  return {
    status: "resolved",
    project: projectResolution.project,
    task: matches[0],
  };
}

function unresolvedUpdateTaskData(
  resolution: UpdateTaskResolution,
  params: UpdateTaskParams
): Record<string, unknown> | null {
  if (resolution.status === "project_unresolved") {
    const result = unresolvedProjectData(resolution.result, params.projectReference);
    return result;
  }
  if (resolution.status === "task_ambiguous") {
    return {
      status: "needs_clarification",
      resource: "task",
      projectName: resolution.project.name,
      taskName: params.taskName,
      choices: resolution.matches.map(taskChoice),
      message: "More than one task matches that name. Ask the user which task they mean.",
    };
  }
  if (resolution.status === "task_not_found") {
    return {
      status: "not_found",
      resource: "task",
      projectName: resolution.project.name,
      taskName: params.taskName,
      choices: [],
      message: "No matching task was found in that project.",
    };
  }
  return null;
}

function updateTaskSummary(projectName: string, params: UpdateTaskParams): string {
  const changes: string[] = [];
  if (params.title !== undefined) changes.push("title");
  if (params.description !== undefined) changes.push("description");
  if (params.priority !== undefined) changes.push("priority");
  if (params.status !== undefined) changes.push("status");
  if (params.assignee !== undefined) changes.push("assignee");
  if (params.assigneeId !== undefined) changes.push("assignee");
  return `Update task "${params.taskName}" in project "${projectName}" (${changes.join(", ")})`;
}

function approvalMatchesUpdateTask(
  approval: {
    toolName: string;
    rawArguments: string;
    requestId: string;
    userId?: string;
    resourceId?: string;
    workspaceId?: string;
    workspaceKind?: "personal" | "shared";
    details: Readonly<Record<string, unknown>>;
  },
  params: UpdateTaskParams,
  project: PersonalProjectRecord,
  task: PersonalTaskRecord,
  rawArguments: string,
  userId: string,
  requestId: string,
  workspaceId: string | undefined,
  workspaceKind: "personal" | "shared"
): boolean {
  if (
    approval.toolName !== UPDATE_PROJECT_TASK_TOOL_NAME ||
    approval.userId !== userId ||
    approval.requestId !== requestId ||
    approval.resourceId !== task.id ||
    approval.workspaceId !== workspaceId ||
    (approval.workspaceKind ?? workspaceKind) !== workspaceKind
  ) {
    return false;
  }
  try {
    if (
      canonicalJson(JSON.parse(approval.rawArguments)) !==
      canonicalJson(JSON.parse(rawArguments))
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return (
    approval.details.projectName === project.name &&
    approval.details.taskName === params.taskName &&
    (approval.details.title ?? "") === (params.title ?? "") &&
    (approval.details.description ?? "") === (params.description ?? "") &&
    (approval.details.priority ?? "") === (params.priority ?? "") &&
    (approval.details.status ?? "") === (params.status ?? "") &&
    (approval.details.assignee ?? "") === (params.assignee ?? "") &&
    (approval.details.assigneeId ?? "") === (params.assigneeId ?? "")
  );
}

async function executeApprovedUpdateTask(
  params: UpdateTaskParams,
  project: PersonalProjectRecord,
  task: PersonalTaskRecord,
  approvalId: string,
  rawArguments: string,
  context: ToolExecutionContext,
  userId: string,
  workspaceId: string | undefined,
  workspaceKind: "personal" | "shared"
): Promise<StructuredToolOutput> {
  const approval = await getApprovalRecord(approvalId);
  if (!approval) {
    return invalidArguments("The approval request was not found or has expired.");
  }
  if (approval.status === "executed" && isRecord(approval.executionResult)) {
    if (
      approvalMatchesUpdateTask(
        approval,
        params,
        project,
        task,
        rawArguments,
        userId,
        context.requestId,
        workspaceId,
        workspaceKind
      )
    ) {
      return { ok: true, data: approval.executionResult };
    }
    return permissionDenied();
  }
  if (
    !approvalMatchesUpdateTask(
      approval,
      params,
      project,
      task,
      rawArguments,
      userId,
      context.requestId,
      workspaceId,
      workspaceKind
    )
  ) {
    return invalidArguments("The approval does not match the requested task update.");
  }
  if (approval.status !== "approved") {
    return executionFailed(
      "This operation can no longer be executed because its approval is not active."
    );
  }
  try {
    await beginApprovalExecutionRecord(approval.id);
  } catch {
    return executionFailed("The approval could not be executed.");
  }

  let updatedTask: PersonalTaskRecord;
  try {
    const updated = await updateWorkspaceTask(context.auth, task.id, {
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.priority !== undefined ? { priority: params.priority } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.assignee !== undefined ? { assignee: params.assignee } : {}),
      ...(params.assigneeId !== undefined
        ? { assigneeId: params.assigneeId }
        : {}),
    });
    if (!updated) throw new Error("Task not found.");
    updatedTask = updated;
  } catch (error) {
    await failApprovalExecutionRecord(
      approval.id,
      error instanceof Error ? error.message : "Task update failed."
    );
    return executionFailed("The approved task could not be updated.");
  }
  await dispatchTaskMutation(context.auth, "task.updated", updatedTask);

  const data = {
    status: "executed" as const,
    projectName: project.name,
    task: taskDetails(updatedTask),
  };
  try {
    await completeApprovalExecutionRecord(approval.id, data);
  } catch {
    const current = await getApprovalRecord(approval.id);
    if (current?.status !== "executed" || !isRecord(current.executionResult)) {
      return executionFailed("The approved task update could not be confirmed.");
    }
    return { ok: true, data: current.executionResult };
  }
  return { ok: true, data };
}

export async function executeUpdateProjectTask(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let params: UpdateTaskParams;
  let userId: string;
  let workspaceId: string | undefined;
  try {
    userId = personalUserIdFromAuth(context?.auth);
    params = parseUpdateTaskArguments(rawArguments);
    workspaceId = await verifiedWorkspaceIdFromAuth(context.auth);
  } catch (error) {
    if (
      error instanceof WorkspaceAccessError ||
      (error instanceof Error && /verified user identity/i.test(error.message))
    ) {
      return permissionDenied();
    }
    return invalidArguments(
      error instanceof Error ? error.message : "Invalid tool arguments."
    );
  }
  const workspaceKind = workspaceId ? "shared" : "personal";
  const approvalId = context.approvalId?.trim();

  if (approvalId) {
    const approval = await getApprovalRecord(approvalId);
    if (!approval || approval.toolName !== UPDATE_PROJECT_TASK_TOOL_NAME) {
      return invalidArguments("The approval request was not found or has expired.");
    }
    if (approval.userId !== userId || approval.requestId !== context.requestId) {
      return permissionDenied();
    }
  }

  let resolution: UpdateTaskResolution;
  try {
    resolution = await resolveTaskForUpdate(params, context);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error)
      ? executionFailed("Personal task data is unavailable right now.")
      : invalidArguments(
          error instanceof Error ? error.message : "Invalid task reference."
        );
  }
  if (resolution.status === "denied") return permissionDenied();
  if (resolution.status !== "resolved") {
    const data = unresolvedUpdateTaskData(resolution, params);
    return data ? { ok: true, data } : executionFailed("The task could not be resolved.");
  }

  if (approvalId) {
    return executeApprovedUpdateTask(
      params,
      resolution.project,
      resolution.task,
      approvalId,
      rawArguments,
      context,
      userId,
      workspaceId,
      workspaceKind
    );
  }

  const summary = updateTaskSummary(resolution.project.name, params);
  const details: Record<string, unknown> = {
    projectName: resolution.project.name,
    taskName: params.taskName,
    title: params.title ?? "",
    description: params.description ?? "",
    priority: params.priority ?? "",
    status: params.status ?? "",
    assignee: params.assignee ?? "",
    assigneeId: params.assigneeId ?? "",
  };
  try {
    const approval = await createApprovalRecord({
      requestId: context.requestId,
      toolName: UPDATE_PROJECT_TASK_TOOL_NAME,
      rawArguments,
      summary,
      details,
      userId,
      resourceId: resolution.task.id,
      workspaceId,
      workspaceKind,
    });
    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: UPDATE_PROJECT_TASK_TOOL_NAME,
        summary,
        details: approval.details,
        notice:
          "This operation requires explicit user approval before execution.",
      },
    };
  } catch {
    return executionFailed("The approval request could not be created.");
  }
}

export async function executeListProjectTasks(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let params: ListTaskParams;
  try {
    const userId = personalUserIdFromAuth(context?.auth);
    if (!userId) return permissionDenied();
    params = parseListTaskArguments(rawArguments);
  } catch (error) {
    if (error instanceof Error && /verified user identity/i.test(error.message)) {
      return permissionDenied();
    }
    return invalidArguments(
      error instanceof Error ? error.message : "Invalid tool arguments."
    );
  }

  let resolution;
  try {
    resolution = await resolveOwnedProject(params.projectReference, context);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error)
      ? executionFailed("Personal task data is unavailable right now.")
      : invalidArguments(
          error instanceof Error ? error.message : "Invalid project reference."
        );
  }

  if (resolution.status === "denied") return permissionDenied();
  if (resolution.status !== "resolved") {
    return {
      ok: true,
      data: unresolvedProjectData(resolution, params.projectReference),
    };
  }

  const project = resolution.project;
  let tasks: readonly PersonalTaskRecord[];
  try {
    tasks = await listWorkspaceTasks(context.auth, project.id);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return executionFailed("Personal task data is unavailable right now.");
  }

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
          message: "No matching task was found for that personal project.",
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
          message: "More than one task matches that name. Ask the user which task they mean.",
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
    },
  };
}
