import {
  getApprovalRequest,
  submitApprovalDecision,
} from "@/lib/approvalWorkflow";
import { executeRegisteredTool } from "@/tools/registry";
import { checkPermission, DEFAULT_DEMO_AUTH_CONTEXT, type UserRole } from "@/lib/permissions";
import { getAuditLogs } from "@/lib/auditLog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const { approvalId, decision, role: customRole } = body;

  if (typeof approvalId !== "string" || !approvalId.trim()) {
    return Response.json({ error: "approvalId is required." }, { status: 400 });
  }

  if (decision !== "approve" && decision !== "reject") {
    return Response.json(
      { error: "decision must be either 'approve' or 'reject'." },
      { status: 400 }
    );
  }

  const approval = getApprovalRequest(approvalId.trim());
  if (!approval) {
    return Response.json(
      { error: `Approval request "${approvalId}" was not found or has expired.` },
      { status: 404 }
    );
  }

  if (approval.status !== "pending") {
    return Response.json(
      { error: `Approval request "${approvalId}" is already ${approval.status}.` },
      { status: 400 }
    );
  }

  // Server-side authorization check for the approver
  const role: UserRole =
    typeof customRole === "string" && (customRole === "viewer" || customRole === "operator" || customRole === "admin")
      ? customRole
      : DEFAULT_DEMO_AUTH_CONTEXT.role;

  const perm = checkPermission(approval.toolName, { role, isDemo: true });
  if (!perm.permitted) {
    return Response.json(
      { error: perm.reason || "Unauthorized to approve this operation." },
      { status: 403 }
    );
  }

  try {
    const updatedApproval = submitApprovalDecision(
      approval.id,
      decision,
      `user-${role}`
    );

    if (decision === "reject") {
      return Response.json({
        ok: true,
        status: "rejected",
        approvalId: updatedApproval.id,
        message: "Operation rejected by user. No action was executed.",
      });
    }

    // Execute the approved operation with replay protection
    let originalArgs: Record<string, unknown> = {};
    try {
      originalArgs = JSON.parse(approval.rawArguments);
    } catch {
      originalArgs = {};
    }

    const executionArgs = JSON.stringify({
      ...originalArgs,
      approvalId: approval.id,
    });

    const executionResult = executeRegisteredTool(
      approval.toolName,
      executionArgs,
      {
        requestId: approval.requestId,
        auth: { role, isDemo: true },
      }
    );

    if (!executionResult.ok) {
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

    return Response.json({
      ok: true,
      status: "executed",
      approvalId: approval.id,
      message: "Operation approved and executed successfully.",
      result: executionResult.data,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while processing approval.",
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
  const logs = getAuditLogs({ limit: 50 });
  return Response.json({
    ok: true,
    auditLogs: logs,
  });
}
