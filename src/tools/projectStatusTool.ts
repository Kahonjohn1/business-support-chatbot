// Personal project tools. All records come from the authenticated user's
// Supabase rows; registration and dispatch live in the central registry.

import type { ToolDefinition } from "@/lib/toolCalling";
import type {
  StructuredToolOutput,
  ToolExecutionContext,
  ToolMetadata,
} from "@/tools/registry";
import {
  personalUserIdFromAuth,
  type PersonalProjectRecord,
  type PersonalProjectStatus,
} from "@/lib/personalProjectData";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import {
  createWorkspaceProject,
  findWorkspaceProjectsByName,
  getWorkspaceProjectById,
  listWorkspaceProjects,
  updateWorkspaceProject,
  verifiedWorkspaceIdFromAuth,
} from "@/lib/workspace/workspaceProjectData";
import {
  beginApprovalExecutionRecord,
  completeApprovalExecutionRecord,
  createApprovalRecord,
  failApprovalExecutionRecord,
  getApprovalRecord,
} from "@/lib/approvalWorkflow";
import { dispatchProjectMutation } from "@/lib/automation/dispatch";

export const GET_PROJECT_STATUS_TOOL_NAME = "get_project_status";
export const LIST_PROJECTS_TOOL_NAME = "list_projects";

export const GET_PROJECT_STATUS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: GET_PROJECT_STATUS_TOOL_NAME,
    description:
      "Look up the status of one of the signed-in user's personal projects by its name. Returns only that user's saved records.",
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
      },
      required: ["projectName"],
      additionalProperties: false,
    },
  },
};

export const LIST_PROJECTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: LIST_PROJECTS_TOOL_NAME,
    description:
      "List or search the signed-in user's personal projects by name. Returns only that user's saved records.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          maxLength: 120,
          description:
            "Optional project name or name fragment to search for, for example website.",
        },
      },
      additionalProperties: false,
    },
  },
};

export const CREATE_PROJECT_TOOL_NAME = "create_project";
export const UPDATE_PROJECT_TOOL_NAME = "update_project";

export const CREATE_PROJECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: CREATE_PROJECT_TOOL_NAME,
    description:
      "Create a new personal project for the signed-in user. Protected action requiring explicit user approval before any record is written.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Name for the new personal project (max 120 characters).",
        },
        status: {
          type: "string",
          enum: ["planned", "active", "blocked", "completed"],
          description: "Initial project status. Defaults to planned.",
        },
        progressNotes: {
          type: "string",
          maxLength: 500,
          description: "Optional initial progress notes (max 500 characters).",
        },
        blockers: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          maxItems: 10,
          description: "Optional list of initial blockers (max 10 items).",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

export const UPDATE_PROJECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: UPDATE_PROJECT_TOOL_NAME,
    description:
      "Update the status, progress notes, or blockers of a project in the active workspace by its business name. Protected action requiring explicit user approval before any record is changed.",
    parameters: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "The project's business name. Use list_projects first if the name is unclear.",
        },
        status: {
          type: "string",
          enum: ["planned", "active", "blocked", "completed"],
          description: "New project status. Omit to leave it unchanged.",
        },
        progressNotes: {
          type: "string",
          maxLength: 500,
          description: "New progress notes. Omit to leave them unchanged.",
        },
        blockers: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          maxItems: 10,
          description: "New blocker list. Omit to leave it unchanged.",
        },
      },
      required: ["projectName"],
      additionalProperties: false,
    },
  },
};

export const CREATE_PROJECT_METADATA: ToolMetadata = {
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
};

export const UPDATE_PROJECT_METADATA: ToolMetadata = {
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
};

export const GET_PROJECT_STATUS_METADATA = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
} as const;

export const LIST_PROJECTS_METADATA = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
} as const;

export const TOOL_USE_INSTRUCTION = [
  "Available personal project operations and rules:",
  "- list_projects: Call when the user has not named a project, or when a project name is unclear. Optionally pass a name fragment as query. Returns only the signed-in user's projects.",
  "- get_project_status: Call when the user asks about the status of a named personal project. Pass the project name.",
  "- list_project_tasks: Call when the user asks to view or list tasks for a named personal project. Pass the project name. Optionally pass a task name to find a specific task by its title.",
  "- create_project: Call when the user asks to create a new named project in the active workspace. Requires a project name. Treat requests such as 'Save this as a project', 'Store this in my workspace', 'Turn this plan into a project', and 'Create a project for this plan' as explicit requests to call create_project. Do not only write a plan and imply that it has been saved.",
  "- update_project: Call when the user asks to change a named project's status, progress notes, or blockers in the active workspace. Requires the project name and at least one field to change. Never invent values that the user did not provide.",
  "- create_project_task: Call when the user asks to create or add a task in a named project in the active workspace. Requires a project name and a task title. Treat requests such as 'Create the associated tasks', 'Add these tasks to the project', and 'Break this project into tasks and save them' as explicit requests to call create_project_task, subject to the approval workflow.",
  "- update_project_task: Call when the user asks to change a named task's title, description, priority, status, or assignee in the active workspace. Requires the project name, current task name, and at least one field to change. Never invent values that the user did not provide.",
  "- create_project, update_project, create_project_task, and update_project_task are protected actions that require explicit user approval. The application automatically displays an approval prompt when a tool returns status: 'pending_approval'; rely on that interface instead of merely asking for approval in ordinary text.",
  "- Use business names only. Never ask the user for a project ID, task ID, database identifier, or API identifier.",
  "- If a tool returns status: 'needs_clarification', ask the user to choose from the returned names. Do not guess which record they mean.",
  "- If a tool returns status: 'not_found', say that no matching personal record was found and ask for a different name if appropriate.",
  "- If a tool returns status: 'already_exists', tell the user that personal project already exists and do not prepare another creation.",
  "- If exactly one project matches the name the user gave, use it automatically.",
  "- Approval ordering: First prepare the project-creation operation. Wait for the user to approve it and for the application to confirm successful execution before preparing task-creation operations. Obtain the required approval for each task operation. Never create tasks against a project that is still pending approval or does not exist. If the project has not yet been approved, explain that task creation must wait.",
  "- Never show project IDs, task IDs, approval IDs, database identifiers, API identifiers, raw tool arguments, or raw JSON to the user. Summarize actions with business names instead.",
  "- Never guess or invent a project name, task title, status, progress note, or blocker. Report only the values returned by tools.",
  "- Approval notice: When a tool returns status: 'pending_approval', summarize the proposed operation by name; the application is responsible for presenting the approval controls.",
  "- Never claim a project or task was created until an execution result confirms it.",
].join("\n");

export const NO_TOOL_USE_INSTRUCTION = [
  "Personal project operations are unavailable for the current model:",
  "- Do not claim to look up or know any project status or task details.",
  "- Never invent a project name, task title, status, progress note, or blocker.",
  "- Never ask the user for an internal project ID or task ID.",
  "- If the user asks for project status or task management, say that those operations are unavailable right now and offer the approved human-support channels.",
].join("\n");

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOOL_ARGUMENT_CHARS = 1_000;
const MAX_PROJECT_NAME_CHARS = 120;
const SOURCE_DECLARATION_LINE =
  /^\s*(?:[*_]{1,2})?\s*sources?\s*(?:[*_]{1,2})?\s*:/i;
const CREATE_PROJECT_KEYS = new Set([
  "name",
  "status",
  "progressNotes",
  "blockers",
]);
const UPDATE_PROJECT_KEYS = new Set([
  "projectName",
  "projectId",
  "status",
  "progressNotes",
  "blockers",
]);
const MAX_PROGRESS_NOTES_CHARS = 500;
const MAX_BLOCKER_CHARS = 200;
const MAX_BLOCKERS = 10;

export type ProjectReference =
  | { kind: "name"; value: string }
  | { kind: "id"; value: string };

export type ProjectResolution =
  | { status: "resolved"; project: PersonalProjectRecord }
  | { status: "ambiguous"; matches: readonly PersonalProjectRecord[] }
  | { status: "not_found" };

export type ProjectChoice = {
  name: string;
  status: PersonalProjectRecord["status"];
};

export type ProjectDetails = {
  name: string;
  status: PersonalProjectRecord["status"];
  updatedAt: string;
  progressNotes: string;
  blockers: readonly string[];
};

interface CreateProjectParams {
  name: string;
  status?: PersonalProjectStatus;
  progressNotes?: string;
  blockers?: string[];
}

interface UpdateProjectParams {
  projectReference: ProjectReference;
  status?: PersonalProjectStatus;
  progressNotes?: string;
  blockers?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(rawArguments: string): Record<string, unknown> {
  if (
    typeof rawArguments !== "string" ||
    rawArguments.length > MAX_TOOL_ARGUMENT_CHARS
  ) {
    throw new Error("Invalid tool arguments.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error("Tool arguments must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }

  return parsed;
}

function parseProjectName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("projectName must be a string.");
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROJECT_NAME_CHARS) {
    throw new Error("projectName must be between 1 and 120 characters.");
  }

  return trimmed;
}

export function parseProjectReference(rawArguments: string): ProjectReference {
  const parsed = parseJsonObject(rawArguments);
  const keys = Object.keys(parsed);

  if (
    keys.length !== 1 ||
    (keys[0] !== "projectName" && keys[0] !== "projectId")
  ) {
    throw new Error("Tool arguments must contain only projectName.");
  }

  if (keys[0] === "projectName") {
    return { kind: "name", value: parseProjectName(parsed.projectName) };
  }

  const projectId = parsed.projectId;
  if (typeof projectId !== "string") {
    throw new Error("projectId must be a string.");
  }

  const trimmed = projectId.trim();
  if (!trimmed || !PROJECT_ID_PATTERN.test(trimmed)) {
    throw new Error("projectId is not a valid project identifier.");
  }

  return { kind: "id", value: trimmed.toLowerCase() };
}

export async function resolveProjectReference(
  reference: ProjectReference,
  auth: unknown
): Promise<ProjectResolution> {
  personalUserIdFromAuth(auth);

  if (reference.kind === "id") {
    const project = await getWorkspaceProjectById(auth, reference.value);
    return project
      ? { status: "resolved", project }
      : { status: "not_found" };
  }

  const matches = await findWorkspaceProjectsByName(auth, reference.value);
  if (matches.length === 1) {
    return { status: "resolved", project: matches[0] };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "not_found" };
}

export function parseListProjectsArguments(rawArguments: string): {
  query?: string;
} {
  if (rawArguments.trim() === "") {
    return {};
  }

  const parsed = parseJsonObject(rawArguments);
  for (const key of Object.keys(parsed)) {
    if (key !== "query") {
      throw new Error(`Unknown argument "${key}".`);
    }
  }

  if (parsed.query === undefined) {
    return {};
  }

  if (typeof parsed.query !== "string") {
    throw new Error("query must be a string.");
  }

  const trimmed = parsed.query.trim();
  if (trimmed.length > MAX_PROJECT_NAME_CHARS) {
    throw new Error("query must not exceed 120 characters.");
  }

  return trimmed ? { query: trimmed } : {};
}

function invalidArguments(message: string): StructuredToolOutput {
  return { ok: false, error: { code: "INVALID_ARGUMENTS", message } };
}

function databaseFailure(): StructuredToolOutput {
  return {
    ok: false,
    error: {
      code: "EXECUTION_FAILED",
      message: "Personal project data is unavailable right now.",
    },
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

function parseCreateProjectArguments(rawArguments: string): CreateProjectParams {
  const parsed = parseJsonObject(rawArguments);
  for (const key of Object.keys(parsed)) {
    if (!CREATE_PROJECT_KEYS.has(key)) {
      throw new Error(`Unknown argument "${key}".`);
    }
  }

  if (typeof parsed.name !== "string") {
    throw new Error("name must be a string.");
  }
  const name = parsed.name.trim();
  if (!name || name.length > MAX_PROJECT_NAME_CHARS) {
    throw new Error("name must be between 1 and 120 characters.");
  }

  let status: PersonalProjectStatus | undefined;
  if ("status" in parsed && parsed.status !== undefined) {
    if (
      parsed.status !== "planned" &&
      parsed.status !== "active" &&
      parsed.status !== "blocked" &&
      parsed.status !== "completed"
    ) {
      throw new Error(
        "status must be 'planned', 'active', 'blocked', or 'completed'."
      );
    }
    status = parsed.status;
  }

  let progressNotes: string | undefined;
  if ("progressNotes" in parsed && parsed.progressNotes !== undefined) {
    if (typeof parsed.progressNotes !== "string") {
      throw new Error("progressNotes must be a string.");
    }
    const notes = parsed.progressNotes.trim();
    if (notes.length > MAX_PROGRESS_NOTES_CHARS) {
      throw new Error("progressNotes must not exceed 500 characters.");
    }
    progressNotes = notes || undefined;
  }

  let blockers: string[] | undefined;
  if ("blockers" in parsed && parsed.blockers !== undefined) {
    if (!Array.isArray(parsed.blockers)) {
      throw new Error("blockers must be an array of strings.");
    }
    if (parsed.blockers.length > MAX_BLOCKERS) {
      throw new Error("blockers must not contain more than 10 items.");
    }
    blockers = parsed.blockers
      .map((blocker) => {
        if (typeof blocker !== "string") {
          throw new Error("blockers must be an array of strings.");
        }
        const trimmed = blocker.trim();
        if (trimmed.length > MAX_BLOCKER_CHARS) {
          throw new Error("blockers must not exceed 200 characters each.");
        }
        return trimmed;
      })
      .filter((blocker) => blocker.length > 0);
  }

  return {
    name,
    ...(status ? { status } : {}),
    ...(progressNotes ? { progressNotes } : {}),
    ...(blockers ? { blockers } : {}),
  };
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

function parseUpdateProjectArguments(rawArguments: string): UpdateProjectParams {
  const parsed = parseJsonObject(rawArguments);
  for (const key of Object.keys(parsed)) {
    if (!UPDATE_PROJECT_KEYS.has(key)) {
      throw new Error(`Unknown argument "${key}".`);
    }
  }

  const params: UpdateProjectParams = {
    projectReference: projectReferenceFromRecord(parsed),
  };

  if ("status" in parsed && parsed.status !== undefined) {
    if (
      parsed.status !== "planned" &&
      parsed.status !== "active" &&
      parsed.status !== "blocked" &&
      parsed.status !== "completed"
    ) {
      throw new Error(
        "status must be 'planned', 'active', 'blocked', or 'completed'."
      );
    }
    params.status = parsed.status;
  }

  if ("progressNotes" in parsed && parsed.progressNotes !== undefined) {
    if (typeof parsed.progressNotes !== "string") {
      throw new Error("progressNotes must be a string.");
    }
    const notes = parsed.progressNotes.trim();
    if (notes.length > MAX_PROGRESS_NOTES_CHARS) {
      throw new Error("progressNotes must not exceed 500 characters.");
    }
    params.progressNotes = notes;
  }

  if ("blockers" in parsed && parsed.blockers !== undefined) {
    if (!Array.isArray(parsed.blockers)) {
      throw new Error("blockers must be an array of strings.");
    }
    if (parsed.blockers.length > MAX_BLOCKERS) {
      throw new Error("blockers must not contain more than 10 items.");
    }
    params.blockers = parsed.blockers
      .map((blocker) => {
        if (typeof blocker !== "string") {
          throw new Error("blockers must be an array of strings.");
        }
        const trimmed = blocker.trim();
        if (trimmed.length > MAX_BLOCKER_CHARS) {
          throw new Error("blockers must not exceed 200 characters each.");
        }
        return trimmed;
      })
      .filter((blocker) => blocker.length > 0);
  }

  if (
    params.status === undefined &&
    params.progressNotes === undefined &&
    params.blockers === undefined
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
      .map((entry) => `${JSON.stringify(entry)}:${canonicalJson(value[entry])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function approvalMatchesCreateProject(
  approval: {
    toolName: string;
    rawArguments: string;
    requestId: string;
    userId?: string;
    workspaceId?: string;
    workspaceKind?: "personal" | "shared";
    details: Readonly<Record<string, unknown>>;
  },
  params: CreateProjectParams,
  rawArguments: string,
  userId: string,
  requestId: string,
  workspaceId: string | undefined,
  workspaceKind: "personal" | "shared"
): boolean {
  if (
    approval.toolName !== CREATE_PROJECT_TOOL_NAME ||
    approval.userId !== userId ||
    approval.requestId !== requestId ||
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
    approval.details.name === params.name &&
    (approval.details.status ?? "planned") === (params.status ?? "planned") &&
    (approval.details.progressNotes ?? "") === (params.progressNotes ?? "") &&
    canonicalJson(approval.details.blockers ?? []) ===
      canonicalJson(params.blockers ?? [])
  );
}

function executedProjectData(project: PersonalProjectRecord) {
  return {
    status: "executed" as const,
    project: toProjectDetails(project),
  };
}

async function executeApprovedCreateProject(
  params: CreateProjectParams,
  approvalId: string,
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let userId: string;
  let workspaceId: string | undefined;
  try {
    userId = personalUserIdFromAuth(context.auth);
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
      (approval.workspaceKind ?? workspaceKind) === workspaceKind
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

  if (
    !approvalMatchesCreateProject(
      approval,
      params,
       rawArguments,
       userId,
        context.requestId,
        workspaceId,
        workspaceKind
      )

  ) {
    return invalidArguments(
      "The approval does not match the requested project details."
    );
  }

  try {
    await beginApprovalExecutionRecord(approval.id);
  } catch {
    return executionFailed("The approval could not be executed.");
  }

  let project: PersonalProjectRecord;
  try {
    project = await createWorkspaceProject(context.auth, {
      name: params.name,
      ...(params.status ? { status: params.status } : {}),
      ...(params.progressNotes ? { progressNotes: params.progressNotes } : {}),
      ...(params.blockers ? { blockers: params.blockers } : {}),
    });
  } catch (error) {
    await failApprovalExecutionRecord(
      approval.id,
      error instanceof Error ? error.message : "Project creation failed."
    );
    return executionFailed("The approved project could not be created.");
  }
  await dispatchProjectMutation(context.auth, "project.created", project);

  const data = executedProjectData(project);
  try {
    await completeApprovalExecutionRecord(approval.id, data);
  } catch {
    const current = await getApprovalRecord(approval.id);
    if (current?.status !== "executed" || !isRecord(current.executionResult)) {
      return executionFailed("The approved project could not be confirmed.");
    }
    return { ok: true, data: current.executionResult };
  }

  return { ok: true, data };
}

export async function executeCreateProject(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let params: CreateProjectParams;
  let userId: string;
  let workspaceId: string | undefined;
  try {
    userId = personalUserIdFromAuth(context?.auth);
    params = parseCreateProjectArguments(rawArguments);
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
    if (!approval || approval.toolName !== CREATE_PROJECT_TOOL_NAME) {
      return invalidArguments("The approval request was not found or has expired.");
    }
    if (approval.userId !== userId) {
      return permissionDenied();
    }
    if (approval.requestId !== context.requestId) {
      return invalidArguments("The approval is not valid for this request.");
    }
    return executeApprovedCreateProject(
      params,
      approvalId,
      rawArguments,
      context
    );
  }

  let existing;
  try {
    existing = await findWorkspaceProjectsByName(context.auth, params.name);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error)
      ? databaseFailure()
      : invalidArguments(
          error instanceof Error ? error.message : "Invalid project reference."
        );
  }
  if (existing.length > 0) {
    return {
      ok: true,
      data: {
        status: "already_exists",
        resource: "project",
        projectName: params.name,
        message:
          "A personal project with that name already exists for the signed-in user.",
      },
    };
  }

  const summary = `Create personal project "${params.name}"`;
  const details: Record<string, unknown> = {
    name: params.name,
    status: params.status ?? "planned",
    progressNotes: params.progressNotes ?? "",
    blockers: params.blockers ?? [],
  };
  try {
    const approval = await createApprovalRecord({
      requestId: context.requestId,
      toolName: CREATE_PROJECT_TOOL_NAME,
      rawArguments,
      summary,
       details,
        userId,
        workspaceId,
        workspaceKind,
      });


    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: CREATE_PROJECT_TOOL_NAME,
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

function approvalMatchesUpdateProject(
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
  params: UpdateProjectParams,
  project: PersonalProjectRecord,
  rawArguments: string,
  userId: string,
  requestId: string,
  workspaceId: string | undefined,
  workspaceKind: "personal" | "shared"
): boolean {
  if (
    approval.toolName !== UPDATE_PROJECT_TOOL_NAME ||
    approval.userId !== userId ||
    approval.requestId !== requestId ||
    approval.resourceId !== project.id ||
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
    (approval.details.status ?? "") === (params.status ?? "") &&
    (approval.details.progressNotes ?? "") === (params.progressNotes ?? "") &&
    canonicalJson(approval.details.blockers ?? []) ===
      canonicalJson(params.blockers ?? [])
  );
}

function updateProjectSummary(
  projectName: string,
  params: UpdateProjectParams
): string {
  const changes: string[] = [];
  if (params.status !== undefined) changes.push("status");
  if (params.progressNotes !== undefined) changes.push("progress notes");
  if (params.blockers !== undefined) changes.push("blockers");
  return `Update project "${projectName}" (${changes.join(", ")})`;
}

function unresolvedUpdateProjectData(
  resolution:
    | { status: "ambiguous"; matches: readonly PersonalProjectRecord[] }
    | { status: "not_found" },
  reference: ProjectReference
): Record<string, unknown> {
  if (resolution.status === "ambiguous") {
    return {
      status: "needs_clarification",
      resource: "project",
      ...(reference.kind === "name" ? { projectName: reference.value } : {}),
      choices: resolution.matches.map(toProjectChoice),
      message:
        "More than one project matches that name. Ask the user which project they mean.",
    };
  }
  return {
    status: "not_found",
    resource: "project",
    ...(reference.kind === "name" ? { projectName: reference.value } : {}),
    message: "No matching project was found in the active workspace.",
  };
}

async function executeApprovedUpdateProject(
  params: UpdateProjectParams,
  project: PersonalProjectRecord,
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
      approvalMatchesUpdateProject(
        approval,
        params,
        project,
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
    !approvalMatchesUpdateProject(
      approval,
      params,
      project,
      rawArguments,
      userId,
      context.requestId,
      workspaceId,
      workspaceKind
    )
  ) {
    return invalidArguments("The approval does not match the requested project update.");
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

  let projectRecord: PersonalProjectRecord;
  try {
    const updated = await updateWorkspaceProject(context.auth, project.id, {
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.progressNotes !== undefined
        ? { progressNotes: params.progressNotes }
        : {}),
      ...(params.blockers !== undefined ? { blockers: params.blockers } : {}),
    });
    if (!updated) throw new Error("Project not found.");
    projectRecord = updated;
  } catch (error) {
    await failApprovalExecutionRecord(
      approval.id,
      error instanceof Error ? error.message : "Project update failed."
    );
    return executionFailed("The approved project could not be updated.");
  }
  await dispatchProjectMutation(context.auth, "project.updated", projectRecord);

  const data = { status: "executed" as const, project: toProjectDetails(projectRecord) };
  try {
    await completeApprovalExecutionRecord(approval.id, data);
  } catch {
    const current = await getApprovalRecord(approval.id);
    if (current?.status !== "executed" || !isRecord(current.executionResult)) {
      return executionFailed("The approved project update could not be confirmed.");
    }
    return { ok: true, data: current.executionResult };
  }
  return { ok: true, data };
}

export async function executeUpdateProject(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let params: UpdateProjectParams;
  let userId: string;
  let workspaceId: string | undefined;
  try {
    userId = personalUserIdFromAuth(context?.auth);
    params = parseUpdateProjectArguments(rawArguments);
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
    if (!approval || approval.toolName !== UPDATE_PROJECT_TOOL_NAME) {
      return invalidArguments("The approval request was not found or has expired.");
    }
    if (approval.userId !== userId || approval.requestId !== context.requestId) {
      return permissionDenied();
    }
  }

  let resolution;
  try {
    resolution = await resolveProjectReference(params.projectReference, context.auth);
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error)
      ? databaseFailure()
      : invalidArguments(
          error instanceof Error ? error.message : "Invalid project reference."
        );
  }
  if (resolution.status !== "resolved") {
    return {
      ok: true,
      data: unresolvedUpdateProjectData(resolution, params.projectReference),
    };
  }

  const project = resolution.project;
  if (approvalId) {
    return executeApprovedUpdateProject(
      params,
      project,
      approvalId,
      rawArguments,
      context,
      userId,
      workspaceId,
      workspaceKind
    );
  }

  const summary = updateProjectSummary(project.name, params);
  const details: Record<string, unknown> = {
    projectName: project.name,
    status: params.status ?? "",
    progressNotes: params.progressNotes ?? "",
    blockers: params.blockers ?? [],
  };
  try {
    const approval = await createApprovalRecord({
      requestId: context.requestId,
      toolName: UPDATE_PROJECT_TOOL_NAME,
      rawArguments,
      summary,
      details,
      userId,
      resourceId: project.id,
      workspaceId,
      workspaceKind,
    });
    return {
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: approval.id,
        action: UPDATE_PROJECT_TOOL_NAME,
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

export async function executeGetProjectStatus(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let reference: ProjectReference;
  try {
    personalUserIdFromAuth(context?.auth);
    reference = parseProjectReference(rawArguments);
  } catch (error) {
    return invalidArguments(
      error instanceof Error ? error.message : "The tool arguments were invalid."
    );
  }

  try {
    const resolution = await resolveProjectReference(reference, context.auth);

    if (resolution.status === "ambiguous") {
      return {
        ok: true,
        data: {
          found: false,
          ambiguous: true,
          status: "needs_clarification",
          resource: "project",
          projectName: reference.value,
          choices: resolution.matches.map(toProjectChoice),
          message:
            "More than one personal project matches that name. Ask the user which project they mean.",
        },
      };
    }

    if (resolution.status === "not_found") {
      return {
        ok: true,
        data: {
          found: false,
          ambiguous: false,
          status: "not_found",
          resource: "project",
          ...(reference.kind === "name"
            ? { projectName: reference.value }
            : {}),
          message:
            "No matching personal project was found. Do not invent project details.",
        },
      };
    }

    return {
      ok: true,
      data: {
        found: true,
        status: "ok",
        project: toProjectDetails(resolution.project),
      },
    };
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error) ? databaseFailure() : invalidArguments(
      error instanceof Error ? error.message : "The project could not be read."
    );
  }
}

export async function executeListProjects(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  let query: string | undefined;
  try {
    personalUserIdFromAuth(context?.auth);
    ({ query } = parseListProjectsArguments(rawArguments));
  } catch (error) {
    return invalidArguments(
      error instanceof Error ? error.message : "The tool arguments were invalid."
    );
  }

  try {
    const projects = await listWorkspaceProjects(context.auth, query);
    const choices = projects.map(toProjectChoice);

    return {
      ok: true,
      data: {
        status: choices.length > 0 ? "ok" : "not_found",
        ...(query ? { query } : {}),
        projects: choices,
        total: choices.length,
        ...(choices.length === 0
          ? { message: "No personal projects match that name." }
          : {}),
      },
    };
  } catch (error) {
    if (isAccessFailure(error)) return permissionDenied();
    return isDatabaseFailure(error) ? databaseFailure() : invalidArguments(
      error instanceof Error ? error.message : "The projects could not be read."
    );
  }
}

export function toProjectChoice(project: PersonalProjectRecord): ProjectChoice {
  return { name: project.name, status: project.status };
}

export function toProjectDetails(
  project: PersonalProjectRecord
): ProjectDetails {
  return {
    name: project.name,
    status: project.status,
    updatedAt: project.updatedAt,
    progressNotes: project.progressNotes,
    blockers: [...project.blockers],
  };
}

export function ensureDemoDataDisclosure(reply: string): string {
  const text = reply.trim();
  if (!text) return text;

  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? "";
  if (SOURCE_DECLARATION_LINE.test(last)) {
    return lines.join("\n");
  }
  return text;
}
