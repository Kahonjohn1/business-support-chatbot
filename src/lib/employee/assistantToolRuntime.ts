import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ToolExecutionResult } from "@/lib/toolCalling";
import type { EmployeeSession } from "./session";
import {
  authorizeAssistantTool,
  buildApprovalRequest,
  parseAssistantToolArguments,
  requiresApproval,
  type AssistantCompanyRole,
  type AssistantToolArguments,
  type AssistantToolContext,
} from "./assistantTools";
import {
  approvalStatusLabels,
  projectStatusLabels,
  taskPriorityLabels,
  taskStatusLabels,
  type ApprovalStatus,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "./operationalTypes";

interface ProjectRow {
  id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
  progress_notes: string;
  blockers: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  task_code: string;
  title: string;
  description: string | null;
  project_id: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  assignee_label: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ApprovalRow {
  id: string;
  approval_ref: string;
  tool_name: string;
  summary: string;
  status: ApprovalStatus;
  requested_by: string | null;
  decision_by: string | null;
  decision_at: string | null;
  created_at: string;
  expires_at: string;
  details: unknown;
}

interface AuditInput {
  action: "permission_check" | "tool_dispatch" | "tool_execution";
  outcome: "permitted" | "denied" | "executed" | "failed";
  toolName?: string;
  operation?: string;
  requestId?: string;
  permissionAllowed?: boolean;
  requiredPermission?: string;
  approvalId?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toolSuccess(value: Record<string, unknown>): ToolExecutionResult {
  return { ok: true, content: JSON.stringify(value) };
}

function toolFailure(error: string): ToolExecutionResult {
  return { ok: false, error };
}

interface FailureLike {
  code?: string | null;
  message?: string | null;
  status?: number | null;
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .slice(0, 300);
}

function reportFailure(toolName: string, operation: string, error: unknown): void {
  const failure = (error ?? {}) as FailureLike;
  console.error("[employee_assistant] operation failed", {
    tool: toolName,
    operation,
    code: typeof failure.code === "string" ? failure.code : null,
    status: typeof failure.status === "number" ? failure.status : null,
    message:
      typeof failure.message === "string"
        ? redactDiagnosticText(failure.message)
        : error instanceof Error
          ? redactDiagnosticText(error.message)
          : null,
  });
}

function blockersOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function projectPayload(row: ProjectRow, taskCount: number) {
  return {
    id: row.id,
    code: row.project_code,
    name: row.name,
    status: row.status,
    statusLabel: projectStatusLabels[row.status] ?? titleCase(row.status),
    progressNotes: row.progress_notes,
    blockers: blockersOf(row.blockers),
    taskCount,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskPayload(row: TaskRow, projectName?: string) {
  return {
    id: row.id,
    code: row.task_code,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    project: projectName ?? null,
    status: row.status,
    statusLabel: taskStatusLabels[row.status] ?? titleCase(row.status),
    priority: row.priority,
    priorityLabel: taskPriorityLabels[row.priority] ?? titleCase(row.priority),
    assigneeId: row.assignee_id,
    assignee: row.assignee_label?.trim() || "Unassigned",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function approvalPayload(row: ApprovalRow) {
  return {
    id: row.id,
    ref: row.approval_ref,
    toolName: row.tool_name,
    summary: row.summary,
    status: row.status,
    statusLabel: approvalStatusLabels[row.status] ?? titleCase(row.status),
    requestedBy: row.requested_by,
    decisionBy: row.decision_by,
    decisionAt: row.decision_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    details: row.details,
  };
}

async function recordAssistantAudit(context: AssistantToolContext, input: AuditInput): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc("record_audit_event", {
      p_company_id: context.companyId,
      p_action: input.action,
      p_outcome: input.outcome,
      p_request_id: input.requestId ?? null,
      p_tool_name: input.toolName ?? null,
      p_operation: input.operation ?? null,
      p_permission_allowed: input.permissionAllowed ?? null,
      p_required_permission: input.requiredPermission ?? null,
      p_approval_id: input.approvalId ?? null,
      p_error_code: input.errorCode ?? null,
      p_duration_ms: null,
      p_details: input.details ?? {},
    });
  } catch (error) {
    reportFailure("assistant_audit", "record_audit_event", error);
    return;
  }
}

export async function getAssistantToolContext(
  session: EmployeeSession
): Promise<AssistantToolContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_memberships")
    .select("company_id, role, status")
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) reportFailure("assistant_context", "company_membership_select", error);
  if (error || !data || !UUID_PATTERN.test(data.company_id)) return null;

  return {
    userId: session.user.id,
    role: session.user.role,
    companyId: data.company_id,
    companyRole: data.role as AssistantCompanyRole,
  };
}

async function searchProjects(
  args: Extract<AssistantToolArguments, { tool: "search_projects" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();
  const query = supabase
    .from("projects")
    .select("id, project_code, name, status, progress_notes, blockers, created_by, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  const { data, error } = await query;
  if (error) {
    reportFailure("search_projects", "projects_select", error);
    return toolFailure("Projects could not be read.");
  }

  const rows = (data ?? []) as ProjectRow[];
  const needle = args.query?.toLowerCase();
  const filtered = rows
    .filter((row) => {
      if (args.status && row.status !== args.status) return false;
      if (!needle) return true;
      return `${row.project_code} ${row.name} ${row.progress_notes}`
        .toLowerCase()
        .includes(needle);
    })
    .slice(0, args.limit);

  const counts = new Map<string, number>();
  const ids = filtered.map((row) => row.id);
  if (ids.length > 0) {
    const taskResult = await supabase
      .from("tasks")
      .select("project_id")
      .in("project_id", ids)
      .limit(500);
    if (taskResult.error) {
      reportFailure("search_projects", "tasks_count", taskResult.error);
      return toolFailure("Tasks could not be counted.");
    }
    for (const row of (taskResult.data ?? []) as Array<{ project_id: string }>) {
      counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
    }
  }

  return toolSuccess({
    companyScoped: true,
    count: filtered.length,
    projects: filtered.map((row) => projectPayload(row, counts.get(row.id) ?? 0)),
  });
}

async function getProjectDetails(
  args: Extract<AssistantToolArguments, { tool: "get_project_details" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();
  let query = supabase
    .from("projects")
    .select("id, project_code, name, status, progress_notes, blockers, created_by, created_at, updated_at");
  if (args.projectId) {
    query = query.eq("id", args.projectId);
  } else if (args.projectCode) {
    query = query.eq("project_code", args.projectCode);
  } else {
    return toolFailure("Provide exactly one project identifier.");
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    reportFailure("get_project_details", "projects_select", error);
    return toolFailure("Project details could not be read.");
  }
  if (!data) {
    return toolSuccess({ found: false, companyScoped: true, reason: "No authorised project matched." });
  }

  const project = data as ProjectRow;
  const taskResult = await supabase
    .from("tasks")
    .select("id, task_code, title, description, project_id, status, priority, assignee_id, assignee_label, created_by, created_at, updated_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (taskResult.error) {
    reportFailure("get_project_details", "tasks_select", taskResult.error);
    return toolFailure("Project tasks could not be read.");
  }

  const tasks = (taskResult.data ?? []) as TaskRow[];
  return toolSuccess({
    found: true,
    companyScoped: true,
    project: projectPayload(project, tasks.length),
    tasks: tasks.map((row) => taskPayload(row, project.name)),
  });
}

async function listTasks(
  context: AssistantToolContext,
  args: Extract<AssistantToolArguments, { tool: "list_tasks" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();

  if (args.projectId) {
    const projectResult = await supabase
      .from("projects")
      .select("id")
      .eq("id", args.projectId)
      .maybeSingle();
    if (projectResult.error) {
      reportFailure("list_tasks", "project_access_check", projectResult.error);
      return toolFailure("Project access could not be verified.");
    }
    if (!projectResult.data) {
      return toolSuccess({ found: false, companyScoped: true, reason: "No authorised project matched." });
    }
  }

  let query = supabase
    .from("tasks")
    .select("id, task_code, title, description, project_id, status, priority, assignee_id, assignee_label, created_by, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(args.limit);
  if (args.projectId) query = query.eq("project_id", args.projectId);
  if (args.status) query = query.eq("status", args.status);
  if (args.assignedToMe) query = query.eq("assignee_id", context.userId);

  const { data, error } = await query;
  if (error) {
    reportFailure("list_tasks", "tasks_select", error);
    return toolFailure("Tasks could not be read.");
  }

  const rows = (data ?? []) as TaskRow[];
  const projectIds = [...new Set(rows.map((row) => row.project_id))];
  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const projectResult = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds)
      .limit(200);
    if (projectResult.error) {
      reportFailure("list_tasks", "task_projects_select", projectResult.error);
      return toolFailure("Task projects could not be read.");
    }
    for (const row of (projectResult.data ?? []) as Array<{ id: string; name: string }>) {
      projectNames.set(row.id, row.name);
    }
  }

  return toolSuccess({
    companyScoped: true,
    count: rows.length,
    tasks: rows.map((row) => taskPayload(row, projectNames.get(row.project_id))),
  });
}

async function getTaskDetails(
  args: Extract<AssistantToolArguments, { tool: "get_task_details" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, task_code, title, description, project_id, status, priority, assignee_id, assignee_label, created_by, created_at, updated_at")
    .eq("id", args.taskId)
    .maybeSingle();
  if (error) {
    reportFailure("get_task_details", "tasks_select", error);
    return toolFailure("Task details could not be read.");
  }
  if (!data) {
    return toolSuccess({ found: false, companyScoped: true, reason: "No authorised task matched." });
  }

  const task = data as TaskRow;
  const projectResult = await supabase
    .from("projects")
    .select("name")
    .eq("id", task.project_id)
    .maybeSingle();
  if (projectResult.error) {
    reportFailure("get_task_details", "task_project_select", projectResult.error);
  }

  return toolSuccess({
    found: true,
    companyScoped: true,
    task: taskPayload(
      task,
      (projectResult.data as { name?: string } | null)?.name ?? undefined
    ),
  });
}

async function checkApprovals(
  args: Extract<AssistantToolArguments, { tool: "check_approvals" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();
  let query = supabase
    .from("approvals")
    .select("id, approval_ref, tool_name, summary, status, requested_by, decision_by, decision_at, created_at, expires_at, details")
    .order("created_at", { ascending: false })
    .limit(args.limit);
  if (args.status) query = query.eq("status", args.status);
  if (args.approvalId) query = query.eq("id", args.approvalId);

  const { data, error } = await query;
  if (error) {
    reportFailure("check_approvals", "approvals_select", error);
    return toolFailure("Approvals could not be read.");
  }

  const rows = (data ?? []) as ApprovalRow[];
  return toolSuccess({
    companyScoped: true,
    count: rows.length,
    approvals: rows.map(approvalPayload),
  });
}

async function submitTaskStatusApproval(
  context: AssistantToolContext,
  args: Extract<AssistantToolArguments, { tool: "request_task_status_change" }>
): Promise<ToolExecutionResult> {
  const supabase = await createClient();
  const taskResult = await supabase
    .from("tasks")
    .select("id, status, task_code")
    .eq("id", args.taskId)
    .maybeSingle();
  if (taskResult.error) {
    reportFailure("request_task_status_change", "task_access_check", taskResult.error);
    return toolFailure("Task access could not be verified.");
  }
  if (!taskResult.data) {
    return toolSuccess({
      submitted: false,
      companyScoped: true,
      reason: "No authorised task matched.",
    });
  }

  const task = taskResult.data as { id: string; status: TaskStatus; task_code: string };
  if (task.status === args.status) {
    return toolFailure("The task already has the requested status.");
  }

  const request = buildApprovalRequest(context, args, {
    fromStatus: task.status,
    approvalRef: `appr_${crypto.randomUUID()}`,
    requestId: crypto.randomUUID(),
  });
  const insertResult = await supabase
    .from("approvals")
    .insert(request)
    .select("id, approval_ref, status")
    .single();
  if (insertResult.error) {
    reportFailure("request_task_status_change", "approvals_insert", insertResult.error);
    await recordAssistantAudit(context, {
      action: "tool_execution",
      outcome: "failed",
      toolName: "request_task_status_change",
      operation: "submit_task_status_approval",
      errorCode: "approval_submission_failed",
      details: { taskId: args.taskId, toStatus: args.status },
    });
    return toolFailure("The approval request could not be submitted.");
  }

  const approval = insertResult.data as { id: string; approval_ref: string; status: ApprovalStatus };
  await recordAssistantAudit(context, {
    action: "tool_execution",
    outcome: "executed",
    toolName: "request_task_status_change",
    operation: "submit_task_status_approval",
    permissionAllowed: true,
    approvalId: approval.id,
    details: {
      approvalRef: approval.approval_ref,
      taskId: args.taskId,
      taskCode: task.task_code,
      fromStatus: task.status,
      toStatus: args.status,
    },
  });

  return toolSuccess({
    submitted: true,
    executed: false,
    requiresApproval: true,
    approvalId: approval.id,
    approvalRef: approval.approval_ref,
    status: approval.status,
    notice:
      "The status change was not applied. A pending approval was submitted for human review.",
  });
}

export async function executeEmployeeAssistantTool(
  context: AssistantToolContext,
  toolName: string,
  rawArguments: string
): Promise<ToolExecutionResult> {
  const authorization = authorizeAssistantTool(context, toolName);
  if (!authorization.ok) {
    await recordAssistantAudit(context, {
      action: "tool_dispatch",
      outcome: "denied",
      toolName,
      operation: "employee_assistant_tool",
      permissionAllowed: false,
      errorCode: "tool_authorization_denied",
      details: { reason: authorization.reason },
    });
    return toolFailure(authorization.reason);
  }

  const parsed = parseAssistantToolArguments(toolName, rawArguments);
  if (!parsed.ok) {
    await recordAssistantAudit(context, {
      action: "tool_dispatch",
      outcome: "denied",
      toolName,
      operation: "employee_assistant_tool",
      permissionAllowed: false,
      errorCode: "invalid_tool_arguments",
      details: { reason: parsed.error },
    });
    return toolFailure(parsed.error);
  }

  if (requiresApproval(toolName)) {
    const executionCheck = authorizeAssistantTool(context, toolName);
    if (!executionCheck.ok) return toolFailure(executionCheck.reason);
  }

  try {
    const args = parsed.args;
    if (args.tool === "search_projects") return await searchProjects(args);
    if (args.tool === "get_project_details") return await getProjectDetails(args);
    if (args.tool === "list_tasks") return await listTasks(context, args);
    if (args.tool === "get_task_details") return await getTaskDetails(args);
    if (args.tool === "check_approvals") return await checkApprovals(args);
    return await submitTaskStatusApproval(context, args);
  } catch (error) {
    reportFailure(toolName, "tool_execution", error);
    await recordAssistantAudit(context, {
      action: "tool_execution",
      outcome: "failed",
      toolName,
      operation: "employee_assistant_tool",
      errorCode: "tool_execution_failed",
      details: {},
    });
    return toolFailure("The tool could not read authorised company data.");
  }
}
