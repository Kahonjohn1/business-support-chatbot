export type ProjectStatus = "planned" | "active" | "blocked" | "completed";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "expired"
  | "failed";

export const projectStatusLabels: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  blocked: "Blocked",
  completed: "Completed",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const approvalStatusLabels: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  executing: "Executing",
  executed: "Executed",
  expired: "Expired",
  failed: "Failed",
};

export interface EmployeeProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  statusLabel: string;
  progress: number;
  owner: string;
  updated: string;
  summary: string;
  taskCount: number;
  team: string[];
  blockers: string[];
}

export interface EmployeeTask {
  id: string;
  code: string;
  title: string;
  project: string;
  projectId: string;
  status: TaskStatus;
  statusLabel: string;
  priority: TaskPriority;
  priorityLabel: string;
  assigneeId: string | null;
  assignee: string;
  updated: string;
  updatedAt: string;
}

export interface EmployeeApproval {
  id: string;
  title: string;
  type: string;
  submitted: string;
  status: ApprovalStatus;
  statusLabel: string;
  detail: string;
}

export interface EmployeeActivity {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
  group: "Today" | "Yesterday" | "Earlier";
  kind: "project" | "task" | "approval" | "automation";
}

export interface EmployeeCompanyData {
  projects: EmployeeProject[];
  tasks: EmployeeTask[];
  approvals: EmployeeApproval[];
  activities: EmployeeActivity[];
}

export function projectStatusTone(status: ProjectStatus) {
  if (status === "active") return "success" as const;
  if (status === "planned") return "info" as const;
  if (status === "blocked") return "danger" as const;
  return "neutral" as const;
}

export function taskStatusTone(status: TaskStatus) {
  if (status === "done") return "success" as const;
  if (status === "in_progress") return "info" as const;
  return "neutral" as const;
}

export function taskPriorityTone(priority: TaskPriority) {
  if (priority === "high") return "danger" as const;
  if (priority === "medium") return "warning" as const;
  return "neutral" as const;
}
