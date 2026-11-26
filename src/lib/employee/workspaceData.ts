import { createClient } from "@/lib/supabase/server";
import {
  approvalStatusLabels,
  projectStatusLabels,
  taskPriorityLabels,
  taskStatusLabels,
  type ApprovalStatus,
  type EmployeeActivity,
  type EmployeeApproval,
  type EmployeeCompanyData,
  type EmployeeProject,
  type EmployeeTask,
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
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ApprovalRow {
  id: string;
  approval_ref: string;
  summary: string;
  tool_name: string;
  status: ApprovalStatus;
  created_at: string;
}

type AuditOutcome =
  | "permitted"
  | "denied"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

interface AuditRow {
  id: string;
  user_id: string | null;
  operation: string | null;
  action: string;
  outcome: AuditOutcome;
  tool_name: string | null;
  details: unknown;
  occurred_at: string;
}

interface EmployeeNameRow {
  id: string;
  full_name: string | null;
}

interface ProfileNameRow {
  id: string;
  display_name: string | null;
}

function requireRows<T>(
  data: T[] | null,
  error: { message: string } | null,
  label: string
): T[] {
  if (error) {
    throw new Error(`Unable to load ${label}`);
  }
  return data ?? [];
}

function shortCode(value: string | null, id: string): string {
  return value?.trim() || id.slice(0, 8).toUpperCase();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function relativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(value);
}

function activityGroup(value: string, now: number): EmployeeActivity["group"] {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Earlier";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 86_400_000) return "Today";
  if (elapsed < 172_800_000) return "Yesterday";
  return "Earlier";
}

function parseBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detailsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function buildDirectory(
  employeeRows: EmployeeNameRow[],
  profileRows: ProfileNameRow[]
): Map<string, string> {
  const names = new Map<string, string>();

  for (const row of profileRows) {
    const name = row.display_name?.trim();
    if (name) names.set(row.id, name);
  }

  for (const row of employeeRows) {
    const name = row.full_name?.trim();
    if (name) names.set(row.id, name);
  }

  return names;
}

function collectUserIds(
  projectRows: ProjectRow[],
  taskRows: TaskRow[],
  auditRows: AuditRow[]
): string[] {
  const ids = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value) ids.add(value);
  };

  for (const row of projectRows) {
    add(row.created_by);
  }
  for (const row of taskRows) {
    add(row.assignee_id);
    add(row.created_by);
  }
  for (const row of auditRows) {
    add(row.user_id);
  }

  return [...ids];
}

function nameFor(names: Map<string, string>, id: string | null, fallback: string): string {
  if (!id) return fallback;
  return names.get(id) ?? fallback;
}

function activityKind(row: AuditRow): EmployeeActivity["kind"] {
  const value = `${row.action} ${row.tool_name ?? ""}`.toLowerCase();
  if (value.includes("automation")) return "automation";
  if (value.includes("task")) return "task";
  if (value.includes("project")) return "project";
  return "approval";
}

function activityAction(row: AuditRow): string {
  const value = `${row.operation ?? ""} ${row.action}`.toLowerCase();
  if (value.includes("approval_requested") || value.includes("requested")) {
    return "requested approval for";
  }
  if (value.includes("approval_decision") || value.includes("decision")) {
    return row.outcome === "rejected" || row.outcome === "denied" ? "rejected" : "approved";
  }
  if (value.includes("execution") || value.includes("executed")) return "executed";
  if (row.outcome === "denied") return "blocked";
  return "updated";
}

function activityTarget(row: AuditRow): string {
  const details = detailsObject(row.details);
  const summary = details.summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  if (row.tool_name) return titleCase(row.tool_name);
  return titleCase(row.action);
}

export async function getEmployeeCompanyData(): Promise<EmployeeCompanyData> {
  const supabase = await createClient();

  const projectResult = await supabase
    .from("projects")
    .select(
      "id, project_code, name, status, progress_notes, blockers, created_by, created_at, updated_at"
    )
    .order("updated_at", { ascending: false });
  const taskResult = await supabase
    .from("tasks")
    .select(
      "id, task_code, title, description, project_id, status, priority, assignee_id, assignee_label, due_date, created_by, created_at, updated_at"
    )
    .order("updated_at", { ascending: false });
  const approvalResult = await supabase
    .from("approvals")
    .select("id, approval_ref, summary, tool_name, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  const auditResult = await supabase
    .from("audit_events")
    .select("id, user_id, operation, action, outcome, tool_name, details, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(100);

  const projectRows = requireRows<ProjectRow>(
    projectResult.data as ProjectRow[] | null,
    projectResult.error,
    "projects"
  );
  const taskRows = requireRows<TaskRow>(
    taskResult.data as TaskRow[] | null,
    taskResult.error,
    "tasks"
  );
  const approvalRows = requireRows<ApprovalRow>(
    approvalResult.data as ApprovalRow[] | null,
    approvalResult.error,
    "approvals"
  );
  const auditRows = requireRows<AuditRow>(
    auditResult.data as AuditRow[] | null,
    auditResult.error,
    "audit events"
  );

  const userIds = collectUserIds(projectRows, taskRows, auditRows);
  let names = new Map<string, string>();

  if (userIds.length > 0) {
    const employeeResult = await supabase
      .from("employee_profiles")
      .select("id, full_name")
      .in("id", userIds);
    const profileResult = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    names = buildDirectory(
      requireRows<EmployeeNameRow>(
        employeeResult.data as EmployeeNameRow[] | null,
        employeeResult.error,
        "employee profiles"
      ),
      requireRows<ProfileNameRow>(
        profileResult.data as ProfileNameRow[] | null,
        profileResult.error,
        "profiles"
      )
    );
  }

  const now = Date.now();
  const projectNames = new Map(projectRows.map((row) => [row.id, row.name]));

  const tasks: EmployeeTask[] = taskRows.map((row) => ({
    id: row.id,
    code: shortCode(row.task_code, row.id),
    title: row.title,
    project: projectNames.get(row.project_id) ?? "Unknown project",
    projectId: row.project_id,
    status: row.status,
    statusLabel: taskStatusLabels[row.status] ?? titleCase(row.status),
    priority: row.priority,
    priorityLabel: taskPriorityLabels[row.priority] ?? titleCase(row.priority),
    assigneeId: row.assignee_id,
    assignee:
      row.assignee_label?.trim() || nameFor(names, row.assignee_id, "Unassigned"),
    dueDate: row.due_date ? formatDate(row.due_date) : "—",
    updated: relativeTime(row.updated_at, now),
    updatedAt: row.updated_at,
  }));

  const tasksByProject = new Map<string, EmployeeTask[]>();
  for (const task of tasks) {
    const existing = tasksByProject.get(task.projectId) ?? [];
    existing.push(task);
    tasksByProject.set(task.projectId, existing);
  }

  const projects: EmployeeProject[] = projectRows.map((row) => {
    const projectTasks = tasksByProject.get(row.id) ?? [];
    const completedTasks = projectTasks.filter((task) => task.status === "done").length;
    const blockers = parseBlockers(row.blockers);
    const progress = projectTasks.length
      ? Math.round((completedTasks / projectTasks.length) * 100)
      : row.status === "completed"
        ? 100
        : 0;

    return {
      id: row.id,
      code: shortCode(row.project_code, row.id),
      name: row.name,
      status: row.status,
      statusLabel: projectStatusLabels[row.status] ?? titleCase(row.status),
      progress,
      owner: nameFor(names, row.created_by, "Unassigned"),
      updated: relativeTime(row.updated_at, now),
      summary:
        row.progress_notes.trim() ||
        (blockers.length > 0 ? `Blockers: ${blockers.join(", ")}` : "No progress notes recorded."),
      taskCount: projectTasks.length,
      team: [...new Set(projectTasks.map((task) => task.assignee))],
      blockers,
    };
  });

  const approvals: EmployeeApproval[] = approvalRows.map((row) => ({
    id: row.approval_ref || row.id,
    title: row.summary,
    type: titleCase(row.tool_name),
    submitted: relativeTime(row.created_at, now),
    status: row.status,
    statusLabel: approvalStatusLabels[row.status] ?? titleCase(row.status),
    detail: titleCase(row.tool_name),
  }));

  const activities: EmployeeActivity[] = auditRows.map((row) => ({
    id: row.id,
    actor: nameFor(names, row.user_id, "Team member"),
    action: activityAction(row),
    target: activityTarget(row),
    time: relativeTime(row.occurred_at, now),
    group: activityGroup(row.occurred_at, now),
    kind: activityKind(row),
  }));

  return { projects, tasks, approvals, activities };
}
