import { randomBytes } from "node:crypto";

/**
 * Audit logging service for tool execution, authorization decisions, and approvals.
 *
 * Security rules:
 * - Never log API keys, authorization bearer tokens, user passwords, or full conversation prompts.
 * - All log payloads are sanitized and structured.
 */

export type AuditOperationStatus =
  | "permitted"
  | "denied"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly toolName: string;
  readonly operation: string;
  readonly status: AuditOperationStatus;
  readonly permissionDecision?: {
    readonly permitted: boolean;
    readonly role?: string;
    readonly requiredPermission?: string;
    readonly reason?: string;
  };
  readonly approvalDecision?: {
    readonly approvalId: string;
    readonly approved: boolean;
    readonly decisionBy?: string;
  };
  readonly executionOutcome?: {
    readonly ok: boolean;
    readonly code?: string;
    readonly durationMs?: number;
  };
  readonly details?: Readonly<Record<string, unknown>>;
}

const MAX_AUDIT_LOG_ENTRIES = 500;
const inMemoryAuditLogs: AuditEvent[] = [];

const SENSITIVE_KEY_PATTERN = /key|token|secret|auth|password|bearer|cookie/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return sanitizeDetails(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Sanitizes arbitrary details objects so sensitive keys are never persisted or printed.
 * Nested objects and arrays are traversed so secrets cannot hide in list entries.
 */
function sanitizeDetails(
  details?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object") return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[REDACTED]"
      : sanitizeValue(value);
  }
  return sanitized;
}

/**
 * Records a structured audit event.
 */
export function recordAuditEvent(
  event: Omit<AuditEvent, "id" | "timestamp"> & { timestamp?: string }
): AuditEvent {
  const fullEvent: AuditEvent = {
    id: `audit_${randomBytes(12).toString("base64url")}`,
    timestamp: event.timestamp || new Date().toISOString(),
    requestId: event.requestId,
    toolName: event.toolName,
    operation: event.operation,
    status: event.status,
    ...(event.permissionDecision ? { permissionDecision: event.permissionDecision } : {}),
    ...(event.approvalDecision ? { approvalDecision: event.approvalDecision } : {}),
    ...(event.executionOutcome ? { executionOutcome: event.executionOutcome } : {}),
    ...(event.details ? { details: sanitizeDetails(event.details) } : {}),
  };

  inMemoryAuditLogs.push(fullEvent);
  if (inMemoryAuditLogs.length > MAX_AUDIT_LOG_ENTRIES) {
    inMemoryAuditLogs.shift();
  }

  try {
    console.log(
      JSON.stringify({
        level: "info",
        phase: "audit.log",
        auditId: fullEvent.id,
        reqId: fullEvent.requestId,
        tool: fullEvent.toolName,
        op: fullEvent.operation,
        status: fullEvent.status,
      })
    );
  } catch {}

  return fullEvent;
}

/**
 * Retrieves audit log entries matching the query parameters.
 */
export function getAuditLogs(filter?: {
  requestId?: string;
  toolName?: string;
  status?: AuditOperationStatus;
  limit?: number;
}): AuditEvent[] {
  let entries = [...inMemoryAuditLogs];

  if (filter?.requestId) {
    entries = entries.filter((e) => e.requestId === filter.requestId);
  }
  if (filter?.toolName) {
    entries = entries.filter((e) => e.toolName === filter.toolName);
  }
  if (filter?.status) {
    entries = entries.filter((e) => e.status === filter.status);
  }

  const limit = filter?.limit ?? entries.length;
  return entries.slice(-limit);
}

/**
 * Clears in-memory audit logs. Intended for test harness isolation.
 */
export function clearAuditLogs(): void {
  inMemoryAuditLogs.length = 0;
}
