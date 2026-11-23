import { randomBytes } from "node:crypto";
import { recordAuditEvent } from "@/lib/auditLog";
import type { WorkspaceKind } from "@/lib/permissions";

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
  /** Server-only owner binding. Never included in model-facing details. */
  readonly userId?: string;
  /** Server-only resource binding, for example an owned project id. */
  readonly resourceId?: string;
  readonly workspaceId?: string;
  readonly workspaceKind?: WorkspaceKind;
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

export interface ApprovalRecordCreateParams {
  requestId: string;
  toolName: string;
  rawArguments: string;
  summary: string;
  details: Record<string, unknown>;
  ttlMs?: number;
  userId?: string;
  resourceId?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
}

export interface ApprovalRecordStore {
  create(params: ApprovalRecordCreateParams): Promise<ApprovalRequest>;
  get(id: string): Promise<ApprovalRequest | undefined>;
  decide(
    id: string,
    decision: "approve" | "reject",
    decisionBy: string
  ): Promise<ApprovalRequest>;
  begin(id: string): Promise<ApprovalRequest>;
  complete(id: string, executionResult?: unknown): Promise<ApprovalRequest>;
  fail(id: string, reason: string): Promise<ApprovalRequest>;
}

const memoryApprovalRecordStore: ApprovalRecordStore = {
  create: async (params) => createApprovalRequest(params),
  get: async (id) => getApprovalRequest(id),
  decide: async (id, decision, decisionBy) =>
    submitApprovalDecision(id, decision, decisionBy),
  begin: async (id) => beginApprovalExecution(id),
  complete: async (id, executionResult) =>
    markApprovalExecuted(id, executionResult),
  fail: async (id, reason) => markApprovalFailed(id, reason),
};

let activeApprovalRecordStore: ApprovalRecordStore | null = null;

async function getApprovalRecordStore(): Promise<ApprovalRecordStore> {
  if (activeApprovalRecordStore) return activeApprovalRecordStore;
  const { supabaseApprovalRecordStore } = await import(
    "@/lib/supabase/approvalRecordStore"
  );
  activeApprovalRecordStore = supabaseApprovalRecordStore;
  return activeApprovalRecordStore;
}

export function setApprovalRecordStore(store: ApprovalRecordStore): void {
  activeApprovalRecordStore = store;
}

export function selectMemoryApprovalRecordStore(): void {
  activeApprovalRecordStore = memoryApprovalRecordStore;
}

export async function createApprovalRecord(
  params: ApprovalRecordCreateParams
): Promise<ApprovalRequest> {
  return getApprovalRecordStore().then((store) => store.create(params));
}

export async function getApprovalRecord(
  id: string
): Promise<ApprovalRequest | undefined> {
  return getApprovalRecordStore().then((store) => store.get(id));
}

export async function decideApprovalRecord(
  id: string,
  decision: "approve" | "reject",
  decisionBy: string
): Promise<ApprovalRequest> {
  return getApprovalRecordStore().then((store) =>
    store.decide(id, decision, decisionBy)
  );
}

export async function beginApprovalExecutionRecord(
  id: string
): Promise<ApprovalRequest> {
  return getApprovalRecordStore().then((store) => store.begin(id));
}

export async function completeApprovalExecutionRecord(
  id: string,
  executionResult?: unknown
): Promise<ApprovalRequest> {
  return getApprovalRecordStore().then((store) =>
    store.complete(id, executionResult)
  );
}

export async function failApprovalExecutionRecord(
  id: string,
  reason: string
): Promise<ApprovalRequest> {
  return getApprovalRecordStore().then((store) => store.fail(id, reason));
}

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
  userId?: string;
  resourceId?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
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
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.workspaceKind ? { workspaceKind: params.workspaceKind } : {}),
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
  selectMemoryApprovalRecordStore();
}
