import { randomBytes } from "node:crypto";
import { recordAuditEvent } from "@/lib/auditLog";

/**
 * Server-side approval management for sensitive/protected business operations.
 *
 * Guarantees:
 * - AI cannot self-approve: an approval token is only accepted through the
 *   server-side approval execution path, never from model-supplied arguments.
 * - Approval state is held server-side for the lifetime of the process.
 * - Expired or rejected requests cannot execute.
 * - Approval tokens are opaque, cryptographically random capabilities.
 * - Replay / duplicate execution protection, with a cached result so retries
 *   are idempotent rather than creating a second operation.
 */

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "expired"
  | "failed";

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
  executionStartedAt?: number;
  executionTimestamp?: number;
  /** Result of a successful execution, retained for idempotent retries. */
  executionResult?: unknown;
  failureReason?: string;
}

const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000; // 15 minutes
const APPROVAL_TOKEN_BYTES = 32;
const inMemoryApprovals = new Map<string, ApprovalRequest>();

function generateApprovalId(): string {
  return `appr_${randomBytes(APPROVAL_TOKEN_BYTES).toString("base64url")}`;
}

function requireApproval(id: string): ApprovalRequest {
  const request = getApprovalRequest(id);
  if (!request) {
    throw new Error(`Approval request "${id}" was not found.`);
  }
  return request;
}

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
  let id = generateApprovalId();
  while (inMemoryApprovals.has(id)) {
    id = generateApprovalId();
  }
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
  const request = requireApproval(id);

  if (request.status === "expired") {
    throw new Error(`Approval request "${id}" has expired.`);
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
 * Reserves an approved request for execution. A second call cannot start the
 * same approval again, which prevents concurrent duplicate writes.
 */
export function beginApprovalExecution(id: string): ApprovalRequest {
  const request = requireApproval(id);

  if (request.status === "executing") {
    throw new Error(
      `Approval request "${id}" is already being executed.`
    );
  }

  if (request.status !== "approved") {
    throw new Error(
      `Approval request "${id}" cannot be executed because status is "${request.status}".`
    );
  }

  request.status = "executing";
  request.executionStartedAt = Date.now();

  recordAuditEvent({
    requestId: request.requestId,
    toolName: request.toolName,
    operation: "approval_execution",
    status: "executing",
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
 * Marks an executing (or approved) request as executed and caches the result.
 * Another call for the same approval is rejected; callers handle cached-result
 * idempotency before reaching this point.
 */
export function markApprovalExecuted(
  id: string,
  executionResult?: unknown
): ApprovalRequest {
  const request = requireApproval(id);

  if (request.status === "executed") {
    throw new Error(
      `Approval request "${id}" has already been executed. Replay prevented.`
    );
  }

  if (request.status !== "executing" && request.status !== "approved") {
    throw new Error(
      `Approval request "${id}" cannot be executed because status is "${request.status}".`
    );
  }

  request.status = "executed";
  request.executionTimestamp = Date.now();
  request.executionResult = executionResult;

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
 * Marks a failed execution as terminal so it cannot be retried with the same
 * approval token. The user must prepare a new request.
 */
export function markApprovalFailed(
  id: string,
  reason: string
): ApprovalRequest {
  const request = requireApproval(id);

  if (request.status === "failed") {
    return request;
  }

  if (request.status !== "executing" && request.status !== "approved") {
    throw new Error(
      `Approval request "${id}" cannot be marked failed because status is "${request.status}".`
    );
  }

  request.status = "failed";
  request.failureReason = reason.slice(0, 500);

  recordAuditEvent({
    requestId: request.requestId,
    toolName: request.toolName,
    operation: "approval_execution",
    status: "failed",
    approvalDecision: {
      approvalId: id,
      approved: true,
    },
    details: {
      summary: request.summary,
      reason: request.failureReason,
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
