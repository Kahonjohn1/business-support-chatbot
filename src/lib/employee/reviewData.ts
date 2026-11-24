import { createClient } from "@/lib/supabase/server";
import {
  approvalStatusLabels,
  type ApprovalStatus,
} from "./operationalTypes";

export type AuditOutcome =
  | "permitted"
  | "denied"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

export type CompanyRole = "owner" | "admin" | "operator" | "viewer" | "customer";

export type AuditEventKind = "project" | "task" | "approval" | "automation" | "team";

interface ApprovalRow {
  id: string;
  approval_ref: string;
  request_id: string;
  conversation_id: string | null;
  task_id: string | null;
  requested_by: string | null;
  tool_name: string;
  raw_arguments: string | null;
  summary: string;
  details: unknown;
  status: ApprovalStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  decision_by: string | null;
  decision_by_user_id: string | null;
  decision_at: string | null;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  execution_result: unknown;
  failure_reason: string | null;
}

interface AuditEventRow {
  id: string;
  user_id: string | null;
  request_id: string | null;
  tool_name: string | null;
  operation: string | null;
  action: string;
  outcome: AuditOutcome;
  permission_allowed: boolean | null;
  required_permission: string | null;
  approval_id: string | null;
  error_code: string | null;
  duration_ms: number | null;
  details: unknown;
  occurred_at: string;
  created_at: string;
}

interface EmployeeNameRow {
  id: string;
  full_name: string | null;
}

interface ProfileNameRow {
  id: string;
  display_name: string | null;
}

export interface ApprovalRecord {
  id: string;
  ref: string;
  requestId: string;
  summary: string;
  toolName: string;
  status: ApprovalStatus;
  statusLabel: string;
  createdAt: string;
  createdLabel: string;
  ageDays: number;
  updatedLabel: string;
  expiresAt: string;
  expiresLabel: string;
  requestedBy: string | null;
  requesterLabel: string;
  decisionAt: string | null;
  decisionLabel: string;
  decidedRecently: boolean;
  executionLabel: string;
  failureReason: string | null;
  rawArguments: string | null;
  detailsLabel: string;
  conversationId: string | null;
  taskId: string | null;
}

export interface AuditEventRecord {
  id: string;
  actorId: string | null;
  actor: string;
  action: string;
  target: string;
  time: string;
  occurredLabel: string;
  group: "Today" | "Yesterday" | "Earlier";
  kind: AuditEventKind;
  outcome: AuditOutcome;
  outcomeLabel: string;
  toolName: string | null;
  operation: string | null;
  requestId: string | null;
  approvalId: string | null;
  permissionAllowed: boolean | null;
  requiredPermission: string | null;
  errorCode: string | null;
  durationMs: number | null;
  detailsLabel: string;
  createdLabel: string;
}

const auditOutcomeLabels: Record<AuditOutcome, string> = {
  permitted: "Permitted",
  denied: "Denied",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function ageInDays(value: string, now: number): number {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

function withinDays(value: string | null, now: number, days: number): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return now - timestamp <= days * 86_400_000;
}

function activityGroup(value: string, now: number): AuditEventRecord["group"] {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Earlier";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 86_400_000) return "Today";
  if (elapsed < 172_800_000) return "Yesterday";
  return "Earlier";
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function jsonLabel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    const serialized = JSON.stringify(value);
    return serialized || "—";
  } catch {
    return "—";
  }
}

function eventKind(value: string): AuditEventKind {
  const normalized = value.toLowerCase();
  if (normalized.includes("project")) return "project";
  if (normalized.includes("task")) return "task";
  if (normalized.includes("automation") || normalized.includes("workflow")) return "automation";
  if (normalized.includes("member") || normalized.includes("employee") || normalized.includes("team")) {
    return "team";
  }
  return "approval";
}

function eventTarget(row: AuditEventRow): string {
  if (row.tool_name) return titleCase(row.tool_name);
  if (row.request_id) return row.request_id;
  if (row.approval_id) return row.approval_id;
  return titleCase(row.action);
}

async function loadNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const supabase = await createClient();
  const employeeResult = await supabase
    .from("employee_profiles")
    .select("id, full_name")
    .in("id", userIds);
  const profileResult = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);

  for (const row of (profileResult.data ?? []) as ProfileNameRow[]) {
    const name = row.display_name?.trim();
    if (name) names.set(row.id, name);
  }
  for (const row of (employeeResult.data ?? []) as EmployeeNameRow[]) {
    const name = row.full_name?.trim();
    if (name) names.set(row.id, name);
  }

  return names;
}

function nameFor(names: Map<string, string>, id: string | null, fallback: string): string {
  if (!id) return fallback;
  return names.get(id) ?? fallback;
}

export function approvalStatusTone(status: ApprovalStatus) {
  if (status === "approved" || status === "executed") return "success" as const;
  if (status === "rejected" || status === "failed") return "danger" as const;
  if (status === "expired") return "neutral" as const;
  if (status === "executing") return "info" as const;
  return "warning" as const;
}

export function auditOutcomeTone(outcome: AuditOutcome) {
  if (outcome === "permitted" || outcome === "approved" || outcome === "executed") {
    return "success" as const;
  }
  if (outcome === "denied" || outcome === "rejected" || outcome === "failed") {
    return "danger" as const;
  }
  if (outcome === "executing") return "info" as const;
  return "warning" as const;
}

export async function getEmployeeCompanyRole(userId: string): Promise<CompanyRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_memberships")
    .select("role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.role as CompanyRole;
}

export async function getApprovalQueue(): Promise<ApprovalRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approvals")
    .select(
      "id, approval_ref, request_id, conversation_id, task_id, requested_by, tool_name, raw_arguments, summary, details, status, created_at, updated_at, expires_at, decision_by, decision_by_user_id, decision_at, execution_started_at, execution_completed_at, execution_result, failure_reason"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("Unable to load approvals");
  }

  const rows = (data ?? []) as ApprovalRow[];
  const userIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.requested_by, row.decision_by_user_id])
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const names = await loadNames(userIds);
  const now = Date.now();

  return rows.map((row): ApprovalRecord => {
    const requester = nameFor(names, row.requested_by, "Team member");
    const decision = row.decision_at
      ? `${nameFor(names, row.decision_by_user_id, row.decision_by ?? "Team member")} · ${relativeTime(row.decision_at, now)}`
      : "—";
    const execution =
      row.execution_completed_at || row.execution_started_at
        ? `${formatDateTime(row.execution_started_at)} → ${formatDateTime(row.execution_completed_at)}`
        : "—";

    return {
      id: row.id,
      ref: row.approval_ref,
      requestId: row.request_id,
      summary: row.summary,
      toolName: titleCase(row.tool_name),
      status: row.status,
      statusLabel: approvalStatusLabels[row.status] ?? titleCase(row.status),
      createdAt: row.created_at,
      createdLabel: formatDateTime(row.created_at),
      ageDays: ageInDays(row.created_at, now),
      updatedLabel: relativeTime(row.updated_at, now),
      expiresAt: row.expires_at,
      expiresLabel: formatDateTime(row.expires_at),
      requestedBy: row.requested_by,
      requesterLabel: requester,
      decisionAt: row.decision_at,
      decisionLabel: decision,
      decidedRecently: withinDays(row.decision_at, now, 7),
      executionLabel: execution,
      failureReason: row.failure_reason,
      rawArguments: row.raw_arguments,
      detailsLabel: jsonLabel(row.details),
      conversationId: row.conversation_id,
      taskId: row.task_id,
    };
  });
}

export async function getAuditLog(): Promise<AuditEventRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select(
      "id, user_id, request_id, tool_name, operation, action, outcome, permission_allowed, required_permission, approval_id, error_code, duration_ms, details, occurred_at, created_at"
    )
    .order("occurred_at", { ascending: false })
    .limit(250);

  if (error) {
    throw new Error("Unable to load audit events");
  }

  const rows = (data ?? []) as AuditEventRow[];
  const userIds = [
    ...new Set(
      rows
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const names = await loadNames(userIds);
  const now = Date.now();

  return rows.map((row): AuditEventRecord => ({
    id: row.id,
    actorId: row.user_id,
    actor: nameFor(names, row.user_id, "Team member"),
    action: titleCase(row.action),
    target: eventTarget(row),
    time: relativeTime(row.occurred_at, now),
    occurredLabel: formatDateTime(row.occurred_at),
    group: activityGroup(row.occurred_at, now),
    kind: eventKind(`${row.action} ${row.tool_name ?? ""}`),
    outcome: row.outcome,
    outcomeLabel: auditOutcomeLabels[row.outcome] ?? titleCase(row.outcome),
    toolName: row.tool_name,
    operation: row.operation,
    requestId: row.request_id,
    approvalId: row.approval_id,
    permissionAllowed: row.permission_allowed,
    requiredPermission: row.required_permission,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
    detailsLabel: jsonLabel(row.details),
    createdLabel: formatDateTime(row.created_at),
  }));
}
