import {
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/employee/operationalTypes";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface CreateProjectInput {
  name: string;
  projectCode: string;
  summary: string;
  status: ProjectStatus;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  assigneeId: string;
  priority: TaskPriority;
  dueDate: string | null;
}

export interface TaskStatusInput {
  taskId: string;
  status: TaskStatus;
}

const projectStatuses: ProjectStatus[] = ["planned", "active", "blocked", "completed"];
const taskStatuses: TaskStatus[] = ["todo", "in_progress", "done"];
const taskPriorities: TaskPriority[] = ["low", "medium", "high"];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const projectCodePattern = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (projectStatuses as string[]).includes(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (taskStatuses as string[]).includes(value);
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (taskPriorities as string[]).includes(value);
}

export function normalizeProjectCode(value: string): string {
  return value
    .toUpperCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomToken(): string {
  const value =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}${Math.random()}`;
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function suggestProjectCode(name: string): string {
  const slug = normalizeProjectCode(name).slice(0, 22).replace(/-+$/, "") || "PROJECT";
  return `${slug}-${randomToken().slice(0, 6)}`;
}

export function createTaskCode(token: string = randomToken()): string {
  return `TASK-${token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8)}`;
}

function parseDueDate(value: unknown): ParseResult<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }

  const text = readText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: false, error: "Enter a valid deadline." };
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return { ok: false, error: "Enter a valid deadline." };
  }

  return { ok: true, value: date.toISOString() };
}

export function parseCreateProjectPayload(payload: unknown): ParseResult<CreateProjectInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid project details." };
  }

  const name = readText(payload.name);
  if (!name || name.length < 3 || name.length > 120) {
    return { ok: false, error: "Project name must be between 3 and 120 characters." };
  }

  const rawCode = readText(payload.projectCode);
  if (!rawCode) {
    return { ok: false, error: "Project code is required." };
  }

  const projectCode = normalizeProjectCode(rawCode);
  if (
    projectCode.length < 3 ||
    projectCode.length > 64 ||
    !projectCodePattern.test(projectCode)
  ) {
    return {
      ok: false,
      error: "Project code may use letters, numbers and single hyphens only.",
    };
  }

  const summary = payload.summary === undefined || payload.summary === null ? "" : payload.summary;
  if (typeof summary !== "string" || summary.trim().length > 2000) {
    return { ok: false, error: "Description must be 2000 characters or fewer." };
  }

  if (!isProjectStatus(payload.status)) {
    return { ok: false, error: "Choose a valid project status." };
  }

  return {
    ok: true,
    value: {
      name,
      projectCode,
      summary: summary.trim(),
      status: payload.status,
    },
  };
}

export function parseCreateTaskPayload(payload: unknown): ParseResult<CreateTaskInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid task details." };
  }

  if (!isUuid(payload.projectId)) {
    return { ok: false, error: "Choose a valid project." };
  }

  const title = readText(payload.title);
  if (!title || title.length < 3 || title.length > 160) {
    return { ok: false, error: "Task title must be between 3 and 160 characters." };
  }

  const description = payload.description === undefined || payload.description === null ? "" : payload.description;
  if (typeof description !== "string" || description.trim().length > 2000) {
    return { ok: false, error: "Description must be 2000 characters or fewer." };
  }

  if (!isUuid(payload.assigneeId)) {
    return { ok: false, error: "Choose an active Marque employee." };
  }

  if (!isTaskPriority(payload.priority)) {
    return { ok: false, error: "Choose a valid priority." };
  }

  const dueDate = parseDueDate(payload.dueDate);
  if (!dueDate.ok) {
    return dueDate;
  }

  return {
    ok: true,
    value: {
      projectId: payload.projectId,
      title,
      description: description.trim(),
      assigneeId: payload.assigneeId,
      priority: payload.priority,
      dueDate: dueDate.value,
    },
  };
}

export function parseTaskStatusPayload(payload: unknown): ParseResult<TaskStatusInput> {
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid status update." };
  }

  if (!isUuid(payload.taskId)) {
    return { ok: false, error: "Choose a valid task." };
  }

  if (!isTaskStatus(payload.status)) {
    return { ok: false, error: "Choose a valid task status." };
  }

  return { ok: true, value: { taskId: payload.taskId, status: payload.status } };
}
