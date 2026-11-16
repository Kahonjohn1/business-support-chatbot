import { recordAuditEvent } from "@/lib/auditLog";

/**
 * Server-side approval management for sensitive/protected business operations.
 *
 * Guarantees:
 * - AI cannot self-approve.
 * - Approval state is persisted server-side.
 * - Expired or rejected requests cannot execute.
 * - Replay / duplicate execution protection.
 */

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "expired";

export interface ApprovalRequest {
  readonly id: string;
  readonly requestId: string;
  readonly toolName: string;
  readonly rawArguments: string;
  readonly summary: string;
  readonly details: Readonly<Record<string, unknown>>;
  status: ApprovalStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  decisionBy?: string;
  decisionTimestamp?: number;
  executionTimestamp?: number;
}

const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000; // 15 minutes
const inMemoryApprovals = new Map<string, ApprovalRequest>();

/**
 * Creates a new pending approval request on the server.
 */
export function createApprovalRequest(params: {
  requestId: string;
  toolName: string;
  rawArguments: string;
  summary: string;
  details: Record<string, unknown>;
  ttlMs?: number;
}): ApprovalRequest {
  const now = Date.now();
  const id = `appr_${Math.random().toString(36).slice(2, 10)}_${now}`;
  const ttl = params.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;

  const request: ApprovalRequest = {
    id,
    requestId: params.requestId,
    toolName: params.toolName,
    rawArguments: params.rawArguments,
    summary: params.summary,
    details: Object.freeze({ ...params.details }),
    status: "pending",
    createdAt: now,
    expiresAt: now + ttl,
  };

  inMemoryApprovals.set(id, request);

  recordAuditEvent({
    requestId: params.requestId,
    toolName: params.toolName,
    operation: "approval_requested",
    status: "pending_approval",
    approvalDecision: {
      approvalId: id,
      approved: false,
    },
    details: {
      summary: params.summary,
      expiresAt: new Date(request.expiresAt).toISOString(),
    },
  });

  return request;
}

/**
 * Retrieves an approval request by its ID, checking for TTL expiration.
 */
export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  const request = inMemoryApprovals.get(id);
  if (!request) return undefined;

  if (request.status === "pending" && Date.now() > request.expiresAt) {
    request.status = "expired";
    recordAuditEvent({
      requestId: request.requestId,
      toolName: request.toolName,
      operation: "approval_expired",
      status: "failed",
      approvalDecision: {
        approvalId: id,
        approved: false,
      },
    });
  }

  return request;
}

/**
 * Submits a human user's decision (approve or reject) for a pending operation.
 */
export function submitApprovalDecision(
  id: string,
  decision: "approve" | "reject",
  decisionBy: string = "user"
): ApprovalRequest {
  const request = getApprovalRequest(id);
  if (!request) {
    throw new Error(`Approval request "${id}" was not found.`);
  }

  if (request.status !== "pending") {
    throw new Error(
      `Approval request "${id}" cannot be decided because it is already "${request.status}".`
    );
  }

  const now = Date.now();
  const approved = decision === "approve";
  request.status = approved ? "approved" : "rejected";
  request.decisionBy = decisionBy;
  request.decisionTimestamp = now;

  recordAuditEvent({
    requestId: request.requestId,
    toolName: request.toolName,
    operation: "approval_decision",
    status: approved ? "approved" : "rejected",
    approvalDecision: {
      approvalId: id,
      approved,
      decisionBy,
    },
    details: {
      summary: request.summary,
      decision,
    },
  });

  return request;
}

/**
 * Marks an approved request as executed to prevent replay / duplicate execution.
 */
export function markApprovalExecuted(id: string): ApprovalRequest {
  const request = getApprovalRequest(id);
  if (!request) {
    throw new Error(`Approval request "${id}" was not found.`);
  }

  if (request.status === "executed") {
    throw new Error(
      `Approval request "${id}" has already been executed. Replay prevented.`
    );
  }

  if (request.status !== "approved") {
    throw new Error(
      `Approval request "${id}" cannot be executed because status is "${request.status}".`
    );
  }

  request.status = "executed";
  request.executionTimestamp = Date.now();

  recordAuditEvent({
    requestId: request.requestId,
    toolName: request.toolName,
    operation: "tool_execution",
    status: "executed",
    approvalDecision: {
      approvalId: id,
      approved: true,
    },
    details: {
      summary: request.summary,
    },
  });

  return request;
}

/**
 * Clears in-memory approval requests. Intended for test harness isolation.
 */
export function clearApprovals(): void {
  inMemoryApprovals.clear();
}
