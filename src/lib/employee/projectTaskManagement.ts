import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMarqueAdministrator } from "@/lib/employee/companyInvitations";
import {
  createTaskCode,
  type CreateProjectInput,
  type CreateTaskInput,
} from "@/lib/employee/projectTaskInput";
import type { EmployeeRole } from "@/lib/employee/roles";
import type { TaskStatus } from "@/lib/employee/operationalTypes";

export interface ManagementContext {
  sessionClient: SupabaseClient;
  actorId: string;
  actorRole: EmployeeRole;
}

export interface TaskAssigneeOption {
  id: string;
  name: string;
}

export type ManagementResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

type Failure = Extract<ManagementResult<never>, { ok: false }>;

interface DbError {
  message?: unknown;
  code?: unknown;
}

function failure(status: number, error: string): Failure {
  return { ok: false, status, error };
}

function errorDetails(error: DbError | null | undefined) {
  return {
    code: typeof error?.code === "string" ? error.code : "",
    message: typeof error?.message === "string" ? error.message.toLowerCase() : "",
  };
}

function writeFailure(label: string, error: DbError | null | undefined): Failure {
  const { code, message } = errorDetails(error);
  if (code === "23505") {
    return failure(409, `That ${label} code is already in use. Try a different code.`);
  }
  if (
    message.includes("permission") ||
    message.includes("policy") ||
    message.includes("row-level security")
  ) {
    return failure(403, "You do not have permission to make this change.");
  }
  return failure(502, `The ${label} could not be saved. Please try again.`);
}

function rpcFailure(label: string, error: DbError | null | undefined): Failure {
  const { message } = errorDetails(error);
  if (message.includes("authentication")) {
    return failure(401, "Sign in to continue.");
  }
  if (message.includes("valid task status")) {
    return failure(400, "Choose a valid task status.");
  }
  if (message.includes("active marque employee")) {
    return failure(403, "Active Marque Technologies employee access is required.");
  }
  if (message.includes("not found") || message.includes("not assigned")) {
    return failure(404, "This task is not assigned to you.");
  }
  if (
    message.includes("permission") ||
    message.includes("policy") ||
    message.includes("row-level security")
  ) {
    return failure(403, "You do not have permission to make this change.");
  }
  return failure(502, `The ${label} could not be completed. Please try again.`);
}

async function assertManager(context: ManagementContext): Promise<Failure | null> {
  if (context.actorRole !== "manager" && context.actorRole !== "admin") {
    return failure(403, "Manager or administrator access is required.");
  }

  const membership = await assertMarqueAdministrator(context.sessionClient, context.actorId);
  return membership && !membership.ok ? membership : null;
}

async function nextTaskCode(sessionClient: SupabaseClient, actorId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createTaskCode();
    const { data, error } = await sessionClient
      .from("tasks")
      .select("task_code")
      .eq("user_id", actorId)
      .eq("task_code", code)
      .maybeSingle();

    if (error) return null;
    if (!data) return code;
  }

  return null;
}

export async function getTaskAssigneeOptions(
  sessionClient: SupabaseClient
): Promise<TaskAssigneeOption[]> {
  const { data, error } = await sessionClient
    .from("employee_profiles")
    .select("id, full_name, status")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (error || !data) return [];

  return data.map((row: { id: string; full_name: string | null }) => ({
    id: row.id,
    name: row.full_name?.trim() || "Marque employee",
  }));
}

export async function createMarqueProject(
  context: ManagementContext,
  input: CreateProjectInput
): Promise<ManagementResult<{ id: string }>> {
  const denied = await assertManager(context);
  if (denied) return denied;

  const { data, error } = await context.sessionClient
    .from("projects")
    .insert({
      name: input.name,
      project_code: input.projectCode,
      status: input.status,
      progress_notes: input.summary,
      user_id: context.actorId,
      created_by: context.actorId,
    })
    .select("id")
    .maybeSingle();

  if (error) return writeFailure("project", error);
  if (!data?.id) return failure(502, "The project could not be saved. Please try again.");

  return { ok: true, data: { id: data.id } };
}

export async function createMarqueTask(
  context: ManagementContext,
  input: CreateTaskInput
): Promise<ManagementResult<{ id: string }>> {
  const denied = await assertManager(context);
  if (denied) return denied;

  const projectCheck = await context.sessionClient.rpc("is_marque_project", {
    p_project_id: input.projectId,
  });
  if (projectCheck.error) return rpcFailure("project check", projectCheck.error);
  if (projectCheck.data !== true) {
    return failure(400, "Choose an active Marque Technologies project.");
  }

  const assigneeCheck = await context.sessionClient.rpc("can_assign_task_to", {
    p_assignee_user_id: input.assigneeId,
  });
  if (assigneeCheck.error) return rpcFailure("assignee check", assigneeCheck.error);
  if (assigneeCheck.data !== true) {
    return failure(400, "Choose an active Marque employee who can be assigned work.");
  }

  const taskCode = await nextTaskCode(context.sessionClient, context.actorId);
  if (!taskCode) {
    return failure(503, "A unique task code could not be generated. Please try again.");
  }

  const { data, error } = await context.sessionClient
    .from("tasks")
    .insert({
      task_code: taskCode,
      title: input.title,
      description: input.description,
      project_id: input.projectId,
      status: "todo" satisfies TaskStatus,
      priority: input.priority,
      assignee_id: input.assigneeId,
      user_id: context.actorId,
      created_by: context.actorId,
      due_date: input.dueDate,
    })
    .select("id")
    .maybeSingle();

  if (error) return writeFailure("task", error);
  if (!data?.id) return failure(502, "The task could not be saved. Please try again.");

  return { ok: true, data: { id: data.id } };
}

export async function updateAssignedTaskStatus(
  sessionClient: SupabaseClient,
  input: { taskId: string; status: TaskStatus }
): Promise<ManagementResult> {
  const { error } = await sessionClient.rpc("update_my_marque_task_status", {
    p_task_id: input.taskId,
    p_status: input.status,
  });

  if (error) return rpcFailure("status update", error);

  return { ok: true, data: undefined };
}
