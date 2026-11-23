import {
  completeApprovalExecutionRecord,
  decideApprovalRecord,
  failApprovalExecutionRecord,
  getApprovalRecord,
} from "@/lib/approvalWorkflow";
import {
  checkPermission,
  type AuthorizationContext,
  type WorkspaceKind,
} from "@/lib/permissions";
import { verifiedWorkspaceIdFromAuth } from "@/lib/workspace/workspaceProjectData";
import { executeRegisteredTool } from "@/tools/registry";

export interface ApprovalDecisionOptions {
  readonly allowedToolNames?: readonly string[];
  readonly requireOwnership?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectedResponse(approvalId: string): Response {
  return Response.json({
    ok: true,
    status: "rejected",
    approvalId,
    message: "Operation rejected by user. No action was executed.",
  });
}

function failedResponse(
  approvalId: string,
  message: string,
  status = 500
): Response {
  return Response.json(
    { ok: false, status: "failed", approvalId, message },
    { status }
  );
}

function isExecutedData(data: unknown): boolean {
  return isRecord(data) && data.status === "executed";
}

function approvalWorkspaceKind(approval: {
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
}): WorkspaceKind | undefined {
  if (approval.workspaceKind) {
    return approval.workspaceKind;
  }
  return approval.workspaceId ? "shared" : "personal";
}

/**
 * Shared decision handler. Personal callers opt into ownership binding and a
 * tool allowlist; the legacy employee route keeps its original behaviour.
 */
export async function handleApprovalDecision(
  request: Request,
  authContext: AuthorizationContext | undefined,
  options: ApprovalDecisionOptions = {}
): Promise<Response> {
  if (!authContext) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const { approvalId, decision } = body;
  if (typeof approvalId !== "string" || !approvalId.trim()) {
    return Response.json(
      { error: "A valid approval request is required." },
      { status: 400 }
    );
  }
  if (decision !== "approve" && decision !== "reject") {
    return Response.json(
      { error: "The approval decision must be approve or reject." },
      { status: 400 }
    );
  }

  const normalizedId = approvalId.trim();
  const approval = await getApprovalRecord(normalizedId);
  if (!approval) {
    return Response.json(
      {
        error:
          "This approval request was not found or has expired. Please prepare the operation again.",
      },
      { status: 404 }
    );
  }

  if (
    options.allowedToolNames &&
    !options.allowedToolNames.includes(approval.toolName)
  ) {
    return Response.json(
      { error: "This operation is not available here." },
      { status: 403 }
    );
  }

  if (options.requireOwnership && approval.userId !== authContext.userId) {
    return Response.json(
      {
        error:
          "This approval request was not found or has expired. Please prepare the operation again.",
      },
      { status: 404 }
    );
  }

  let currentWorkspaceId: string | undefined;
  try {
    currentWorkspaceId = await verifiedWorkspaceIdFromAuth(authContext);
  } catch {
    currentWorkspaceId = undefined;
  }
  const currentWorkspaceKind: WorkspaceKind = currentWorkspaceId
    ? "shared"
    : "personal";
  const approvalKind = approvalWorkspaceKind(approval);
  if (
    approvalKind !== currentWorkspaceKind ||
    approval.workspaceId !== currentWorkspaceId
  ) {
    return Response.json(
      {
        error:
          "This approval request was not found or has expired. Please prepare the operation again.",
      },
      { status: 404 }
    );
  }

  const perm = checkPermission(approval.toolName, authContext);
  if (!perm.permitted) {
    return Response.json(
      { error: perm.reason || "Unauthorized to approve this operation." },
      { status: 403 }
    );
  }

  if (decision === "reject") {
    if (approval.status === "rejected") {
      return rejectedResponse(approval.id);
    }
    if (approval.status !== "pending") {
      return Response.json(
        { error: "This approval can no longer be rejected." },
        { status: 409 }
      );
    }

    try {
      await decideApprovalRecord(
        approval.id,
        "reject",
        options.requireOwnership ? authContext.userId : `user-${authContext.role}`
      );
      return rejectedResponse(approval.id);
    } catch {
      return Response.json(
        { error: "The approval decision could not be recorded." },
        { status: 409 }
      );
    }
  }

  if (approval.status === "executed") {
    return Response.json({
      ok: true,
      status: "executed",
      approvalId: approval.id,
      message: "Operation was already approved and executed successfully.",
      ...(isRecord(approval.executionResult)
        ? { result: approval.executionResult }
        : {}),
    });
  }

  if (approval.status !== "pending") {
    return Response.json(
      { error: "This approval can no longer be approved." },
      { status: 409 }
    );
  }

  try {
    await decideApprovalRecord(
      approval.id,
      "approve",
      options.requireOwnership ? authContext.userId : `user-${authContext.role}`
    );
  } catch {
    return Response.json(
      { error: "The approval decision could not be recorded." },
      { status: 409 }
    );
  }

  let originalArgs: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(approval.rawArguments);
    if (!isRecord(parsed)) {
      throw new Error("Approved arguments are not an object.");
    }
    originalArgs = parsed;
  } catch {
    await failApprovalExecutionRecord(approval.id, "The approved operation arguments are invalid.");
    return failedResponse(
      approval.id,
      "The approved operation arguments are invalid."
    );
  }

  const executionResult = await executeRegisteredTool(
    approval.toolName,
    JSON.stringify(originalArgs),
    {
      requestId: approval.requestId,
      auth: authContext,
      approvalId: approval.id,
    }
  );

  if (!executionResult.ok || !isExecutedData(executionResult.data)) {
    const message = executionResult.ok
      ? "The approved operation was not confirmed."
      : executionResult.error;
    const afterFailure = await getApprovalRecord(approval.id);
    if (
      afterFailure &&
      (afterFailure.status === "approved" || afterFailure.status === "executing")
    ) {
      try {
        await failApprovalExecutionRecord(approval.id, message);
      } catch {}
    }
    return failedResponse(approval.id, message);
  }

  const afterExecution = await getApprovalRecord(approval.id);
  if (afterExecution?.status !== "executed") {
    if (
      afterExecution &&
      (afterExecution.status === "approved" || afterExecution.status === "executing")
    ) {
      try {
        await completeApprovalExecutionRecord(approval.id, executionResult.data);
      } catch {}
    }
  }

  const finalized = await getApprovalRecord(approval.id);
  if (
    finalized?.status !== "executed" ||
    !isExecutedData(finalized.executionResult)
  ) {
    return failedResponse(
      approval.id,
      "The approved operation could not be confirmed."
    );
  }

  return Response.json({
    ok: true,
    status: "executed",
    approvalId: approval.id,
    message: "Operation approved and executed successfully.",
    result: finalized.executionResult,
  });
}
