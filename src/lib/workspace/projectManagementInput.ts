import type {
  PersonalProjectStatus,
  PersonalTaskPriority,
  PersonalTaskStatus,
  UpdatePersonalProjectInput,
  UpdatePersonalTaskInput,
} from "@/lib/personalProjectData";
import type {
  CreateWorkspaceProjectInput,
  CreateWorkspaceTaskInput,
} from "@/lib/workspace/workspaceProjectData";

const MAX_NAME_CHARS = 120;
const MAX_NOTES_CHARS = 500;
const MAX_TITLE_CHARS = 100;
const MAX_ASSIGNEE_CHARS = 50;
const MAX_ASSIGNEE_ID_CHARS = 200;
const MAX_BLOCKER_CHARS = 200;
const MAX_BLOCKERS = 10;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new Error(`${field} must be between 1 and ${max} characters.`);
  }
  return trimmed;
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
  max: number
): string | undefined {
  if (!(field in body) || body[field] === undefined) return undefined;
  if (typeof body[field] !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = body[field].trim();
  if (trimmed.length > max) {
    throw new Error(`${field} must not exceed ${max} characters.`);
  }
  return trimmed;
}

function optionalAssigneeId(
  body: Record<string, unknown>
): string | null | undefined {
  if (!("assigneeId" in body) || body.assigneeId === undefined) return undefined;
  if (typeof body.assigneeId !== "string") {
    throw new Error("assigneeId must be a string.");
  }
  const trimmed = body.assigneeId.trim();
  if (trimmed.length > MAX_ASSIGNEE_ID_CHARS) {
    throw new Error(`assigneeId must not exceed ${MAX_ASSIGNEE_ID_CHARS} characters.`);
  }
  return trimmed || null;
}

function projectStatus(value: unknown): PersonalProjectStatus {
  if (
    value === "planned" ||
    value === "active" ||
    value === "blocked" ||
    value === "completed"
  ) {
    return value;
  }
  throw new Error("status must be planned, active, blocked, or completed.");
}

function taskPriority(value: unknown): PersonalTaskPriority {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("priority must be low, medium, or high.");
}

function taskStatus(value: unknown): PersonalTaskStatus {
  if (value === "todo" || value === "in_progress" || value === "done") {
    return value;
  }
  throw new Error("status must be todo, in_progress, or done.");
}

function blockers(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("blockers must be an array.");
  if (value.length > MAX_BLOCKERS) {
    throw new Error(`blockers must not contain more than ${MAX_BLOCKERS} items.`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error("blockers must contain only strings.");
    }
    const trimmed = item.trim();
    if (trimmed.length > MAX_BLOCKER_CHARS) {
      throw new Error(`blockers must not exceed ${MAX_BLOCKER_CHARS} characters each.`);
    }
    return trimmed;
  }).filter((item) => item.length > 0);
}

export function parseCreateProjectInput(body: unknown): CreateWorkspaceProjectInput {
  if (!isRecord(body)) throw new Error("Invalid request payload.");
  const name = requireString(body.name, "name", MAX_NAME_CHARS);
  return {
    name,
    ...("status" in body && body.status !== undefined
      ? { status: projectStatus(body.status) }
      : {}),
    ...("progressNotes" in body && body.progressNotes !== undefined
      ? { progressNotes: optionalString(body, "progressNotes", MAX_NOTES_CHARS) ?? "" }
      : {}),
    ...("blockers" in body && body.blockers !== undefined
      ? { blockers: blockers(body.blockers) }
      : {}),
  };
}

export function parseUpdateProjectInput(body: unknown): UpdatePersonalProjectInput {
  if (!isRecord(body)) throw new Error("Invalid request payload.");
  const input: Record<string, unknown> = {};
  if ("name" in body && body.name !== undefined) {
    input.name = requireString(body.name, "name", MAX_NAME_CHARS);
  }
  if ("status" in body && body.status !== undefined) {
    input.status = projectStatus(body.status);
  }
  if ("progressNotes" in body && body.progressNotes !== undefined) {
    input.progressNotes = optionalString(body, "progressNotes", MAX_NOTES_CHARS) ?? "";
  }
  if ("blockers" in body && body.blockers !== undefined) {
    input.blockers = blockers(body.blockers);
  }
  if (Object.keys(input).length === 0) {
    throw new Error("At least one project field must be provided.");
  }
  return input as UpdatePersonalProjectInput;
}

export function parseCreateTaskInput(body: unknown): CreateWorkspaceTaskInput {
  if (!isRecord(body)) throw new Error("Invalid request payload.");
  const projectId = requireString(body.projectId, "projectId", 200);
  const title = requireString(body.title, "title", MAX_TITLE_CHARS);
  return {
    projectId,
    title,
    ...("description" in body && body.description !== undefined
      ? { description: optionalString(body, "description", MAX_NOTES_CHARS) ?? "" }
      : {}),
    ...("priority" in body && body.priority !== undefined
      ? { priority: taskPriority(body.priority) }
      : {}),
    ...("assignee" in body && body.assignee !== undefined
      ? {
          assignee:
            optionalString(body, "assignee", MAX_ASSIGNEE_CHARS) || "Unassigned",
        }
      : {}),
    ...("assigneeId" in body
      ? { assigneeId: optionalAssigneeId(body) }
      : {}),
  };
}

export function parseUpdateTaskInput(body: unknown): UpdatePersonalTaskInput {
  if (!isRecord(body)) throw new Error("Invalid request payload.");
  const input: Record<string, unknown> = {};
  if ("title" in body && body.title !== undefined) {
    input.title = requireString(body.title, "title", MAX_TITLE_CHARS);
  }
  if ("description" in body && body.description !== undefined) {
    input.description = optionalString(body, "description", MAX_NOTES_CHARS) ?? "";
  }
  if ("priority" in body && body.priority !== undefined) {
    input.priority = taskPriority(body.priority);
  }
  if ("status" in body && body.status !== undefined) {
    input.status = taskStatus(body.status);
  }
  if ("assignee" in body && body.assignee !== undefined) {
    input.assignee =
      optionalString(body, "assignee", MAX_ASSIGNEE_CHARS) || "Unassigned";
  }
  if ("assigneeId" in body) {
    input.assigneeId = optionalAssigneeId(body);
  }
  if (Object.keys(input).length === 0) {
    throw new Error("At least one task field must be provided.");
  }
  return input as UpdatePersonalTaskInput;
}
