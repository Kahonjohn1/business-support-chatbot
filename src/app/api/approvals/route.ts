import {
  getApprovalRequest,
  markApprovalExecuted,
  markApprovalFailed,
  submitApprovalDecision,
} from "@/lib/approvalWorkflow";
import { executeRegisteredTool } from "@/tools/registry";
import { apiErrorFromException } from "@/lib/http/api";
import {
  checkPermission,
  type AuthorizationContext,
} from "@/lib/permissions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rejectedResponse(approvalId: string): Response {
  return Response.json({
    ok: true,
    status: "rejected",
    approvalId,
    message: "Operation rejected by user. No action was executed.",
  });
}

export async function POST(request: Request): Promise<Response> {
  let authContext: AuthorizationContext;
  try {
    const { requireEmployeeAuthorizationContext } = await import("@/lib/workspace/server");
    authContext = await requireEmployeeAuthorizationContext();
  } catch (error) {
    return apiErrorFromException(error);
  }
  return handleApprovalPost(request, authContext);
}

export async function handleApprovalPost(
  request: Request,
  authContext: AuthorizationContext | undefined
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
  const approval = getApprovalRequest(normalizedId);
  if (!approval) {
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
      submitApprovalDecision(
        approval.id,
        "reject",
        authContext.userId
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
      result: approval.executionResult ?? null,
    });
  }

  if (approval.status !== "pending") {
    return Response.json(
      { error: "This approval can no longer be approved." },
      { status: 409 }
    );
  }

  try {
    submitApprovalDecision(
      approval.id,
      "approve",
      `user-${authContext.role}`
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
    markApprovalFailed(approval.id, "The approved operation arguments are invalid.");
    return Response.json(
      {
        ok: false,
        status: "failed",
        approvalId: approval.id,
        message: "The approved operation arguments are invalid.",
      },
      { status: 500 }
    );
  }

  const executionResult = executeRegisteredTool(
    approval.toolName,
    JSON.stringify(originalArgs),
    {
      requestId: approval.requestId,
      auth: authContext,
      approvalId: approval.id,
    }
  );

  const afterExecution = getApprovalRequest(approval.id);

  if (!executionResult.ok) {
    if (
      afterExecution &&
      (afterExecution.status === "approved" || afterExecution.status === "executing")
    ) {
      try {
        markApprovalFailed(approval.id, executionResult.error);
      } catch {}
    }

    return Response.json(
      {
        ok: false,
        status: "failed",
        approvalId: approval.id,
        message: executionResult.error,
      },
      { status: 500 }
    );
  }

  if (
    afterExecution &&
    (afterExecution.status === "approved" || afterExecution.status === "executing")
  ) {
    try {
      markApprovalExecuted(approval.id, executionResult.data);
    } catch {}
  }

  const finalized = getApprovalRequest(approval.id);

  return Response.json({
    ok: true,
    status: "executed",
    approvalId: approval.id,
    message: "Operation approved and executed successfully.",
    result: finalized?.executionResult ?? executionResult.data,
  });
}

export async function GET(): Promise<Response> {
  return Response.json(
    { error: "Audit logs are not exposed by this endpoint." },
    { status: 403 }
  );
}
