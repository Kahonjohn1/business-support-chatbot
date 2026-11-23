import "server-only";

import type {
  ApprovalRecordCreateParams,
  ApprovalRecordStore,
  ApprovalRequest,
  ApprovalStatus,
} from "@/lib/approvalWorkflow";

type ApprovalRow = Record<string, unknown>;

function requireApprovalId(id: string): string {
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("A valid approval request id is required.");
  }
  return id.trim();
}

function timestampToMs(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapApproval(row: ApprovalRow): ApprovalRequest {
  const createdAt = timestampToMs(row.created_at);
  const expiresAt = timestampToMs(row.expires_at);
  if (createdAt === undefined || expiresAt === undefined) {
    throw new Error("The approval record has invalid timestamps.");
  }

  const status = row.status as ApprovalStatus;
  const request: ApprovalRequest = {
    id: String(row.approval_ref),
    requestId: String(row.request_id),
    toolName: String(row.tool_name),
    rawArguments: String(row.raw_arguments),
    summary: String(row.summary),
    details: Object.freeze(
      row.details && typeof row.details === "object"
        ? (row.details as Record<string, unknown>)
        : {}
    ),
    ...(typeof row.resource_id === "string" && row.resource_id
      ? { resourceId: row.resource_id }
      : {}),
    ...(typeof row.workspace_id === "string" && row.workspace_id
      ? { workspaceId: row.workspace_id }
      : {}),
    ...(row.workspace_kind === "personal" || row.workspace_kind === "shared"
      ? { workspaceKind: row.workspace_kind }
      : {}),
    ...(typeof row.user_id === "string" && row.user_id
      ? { userId: row.user_id }
      : {}),
    status,
    createdAt,
    expiresAt,
  };

  const decisionTimestamp = timestampToMs(row.decision_at);
  if (typeof row.decision_by === "string" && row.decision_by) {
    request.decisionBy = row.decision_by;
  }
  if (decisionTimestamp !== undefined) {
    request.decisionTimestamp = decisionTimestamp;
  }
  const executionStartedAt = timestampToMs(row.execution_started_at);
  if (executionStartedAt !== undefined) {
    request.executionStartedAt = executionStartedAt;
  }
  const executionTimestamp = timestampToMs(row.execution_completed_at);
  if (executionTimestamp !== undefined) {
    request.executionTimestamp = executionTimestamp;
  }
  if (row.execution_result !== null && row.execution_result !== undefined) {
    request.executionResult = row.execution_result;
  }
  if (typeof row.failure_reason === "string" && row.failure_reason) {
    request.failureReason = row.failure_reason;
  }

  return request;
}

async function createClient() {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  return createSupabaseServerClient();
}

function rpcError(operation: string, message: string): Error {
  return new Error(`Approval ${operation} failed: ${message.slice(0, 200)}`);
}

async function callApprovalRpc(
  operation: string,
  rpc: "create_approval_request" | "get_approval_request" | "decide_approval_request" | "begin_approval_execution_request" | "complete_approval_execution_request" | "fail_approval_execution_request",
  params: Record<string, unknown>
): Promise<ApprovalRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpc, params);
  if (error) throw rpcError(operation, error.message);
  if (!data) throw new Error(`Approval ${operation} returned no record.`);
  return data as ApprovalRow;
}

export const supabaseApprovalRecordStore: ApprovalRecordStore = {
  async create(params: ApprovalRecordCreateParams): Promise<ApprovalRequest> {
    const row = await callApprovalRpc("creation", "create_approval_request", {
      p_request_id: params.requestId,
      p_tool_name: params.toolName,
      p_raw_arguments: params.rawArguments,
      p_summary: params.summary,
      p_details: params.details,
      p_resource_id: params.resourceId ?? null,
      p_workspace_id: params.workspaceId ?? null,
      p_workspace_kind: params.workspaceKind ?? "personal",
      p_ttl_ms: Math.max(1, Math.floor(params.ttlMs ?? 15 * 60 * 1000)),
    });
    return mapApproval(row);
  },

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const row = await callApprovalRpc("retrieval", "get_approval_request", {
      p_approval_id: requireApprovalId(id),
    });
    return row ? mapApproval(row) : undefined;
  },

  async decide(
    id: string,
    decision: "approve" | "reject",
    _decisionBy: string
  ): Promise<ApprovalRequest> {
    void _decisionBy;
    const row = await callApprovalRpc("decision", "decide_approval_request", {
      p_approval_id: requireApprovalId(id),
      p_decision: decision,
    });
    return mapApproval(row);
  },

  async begin(id: string): Promise<ApprovalRequest> {
    const row = await callApprovalRpc(
      "execution start",
      "begin_approval_execution_request",
      { p_approval_id: requireApprovalId(id) }
    );
    return mapApproval(row);
  },

  async complete(
    id: string,
    executionResult?: unknown
  ): Promise<ApprovalRequest> {
    const row = await callApprovalRpc(
      "completion",
      "complete_approval_execution_request",
      {
        p_approval_id: requireApprovalId(id),
        p_result: executionResult ?? null,
      }
    );
    return mapApproval(row);
  },

  async fail(id: string, reason: string): Promise<ApprovalRequest> {
    const row = await callApprovalRpc("failure", "fail_approval_execution_request", {
      p_approval_id: requireApprovalId(id),
      p_reason: reason.slice(0, 500),
    });
    return mapApproval(row);
  },
};
