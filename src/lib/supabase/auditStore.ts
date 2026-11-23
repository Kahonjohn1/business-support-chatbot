import "server-only";

import type {
  AuditEvent,
  AuditEventContext,
  AuditEventWrite,
  AuditLogFilter,
  DurableAuditStore,
} from "@/lib/auditLog";

type AuditRow = Record<string, unknown>;

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mapAudit(row: AuditRow): AuditEvent {
  const occurredAt = row.occurred_at;
  const permissionDecision = optionalObject(row.permission_decision);
  const approvalDecision = optionalObject(row.approval_decision);
  const executionOutcome = optionalObject(row.execution_outcome);
  const details = optionalObject(row.details);
  const approvalId = approvalDecision
    ? optionalText(approvalDecision.approvalId)
    : undefined;

  return {
    id: String(row.id),
    timestamp:
      typeof occurredAt === "string"
        ? occurredAt
        : new Date(Number(occurredAt)).toISOString(),
    requestId: String(row.request_id ?? ""),
    toolName: String(row.tool_name ?? ""),
    operation: String(row.operation),
    status: row.status as AuditEvent["status"],
    ...(permissionDecision
      ? {
          permissionDecision: {
            permitted: permissionDecision.permitted === true,
            ...(optionalText(permissionDecision.role)
              ? { role: optionalText(permissionDecision.role) }
              : {}),
            ...(optionalText(permissionDecision.requiredPermission)
              ? {
                  requiredPermission: optionalText(
                    permissionDecision.requiredPermission
                  ),
                }
              : {}),
            ...(optionalText(permissionDecision.reason)
              ? { reason: optionalText(permissionDecision.reason) }
              : {}),
          },
        }
      : {}),
    ...(approvalId
      ? {
          approvalDecision: {
            approvalId,
            approved: approvalDecision?.approved === true,
            ...(optionalText(approvalDecision?.decisionBy)
              ? { decisionBy: optionalText(approvalDecision?.decisionBy) }
              : {}),
          },
        }
      : {}),
    ...(executionOutcome
      ? {
          executionOutcome: {
            ok: executionOutcome.ok === true,
            ...(optionalText(executionOutcome.code)
              ? { code: optionalText(executionOutcome.code) }
              : {}),
            ...(typeof executionOutcome.durationMs === "number"
              ? { durationMs: executionOutcome.durationMs }
              : {}),
          },
        }
      : {}),
    ...(details ? { details } : {}),
  };
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

function auditScope(context?: AuditEventContext): {
  scope: "personal" | "shared";
  workspaceId: string | null;
} {
  if (context?.workspaceKind === "shared" && context.workspaceId) {
    return { scope: "shared", workspaceId: context.workspaceId };
  }
  return { scope: "personal", workspaceId: null };
}

export const supabaseAuditStore: DurableAuditStore = {
  async append(
    event: AuditEventWrite,
    context?: AuditEventContext
  ): Promise<AuditEvent> {
    const scope = auditScope(context);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_tool_audit_event", {
      p_scope: scope.scope,
      p_workspace_id: scope.workspaceId,
      p_request_id: event.requestId,
      p_tool_name: event.toolName,
      p_operation: event.operation,
      p_status: event.status,
      p_permission_decision: event.permissionDecision ?? null,
      p_approval_ref: event.approvalDecision?.approvalId ?? null,
      p_approval_decision: event.approvalDecision ?? null,
      p_execution_outcome: event.executionOutcome ?? null,
      p_details: event.details ?? {},
    });
    if (error) {
      throw new Error(
        `Audit event persistence failed: ${error.message.slice(0, 200)}`
      );
    }
    return mapAudit(data as AuditRow);
  },

  async list(filter?: AuditLogFilter): Promise<AuditEvent[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_tool_audit_events", {
      p_request_id: filter?.requestId ?? null,
      p_tool_name: filter?.toolName ?? null,
      p_status: filter?.status ?? null,
      p_limit: Math.max(1, Math.min(filter?.limit ?? 100, 500)),
    });
    if (error) {
      throw new Error(
        `Audit log retrieval failed: ${error.message.slice(0, 200)}`
      );
    }
    return ((data ?? []) as AuditRow[]).map(mapAudit);
  },
};
