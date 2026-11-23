import {
  beginApprovalExecution,
  createApprovalRequest,
  getApprovalRequest,
  markApprovalExecuted,
  markApprovalFailed,
} from "@/lib/approvalWorkflow";
import {
  AUTOMATION_PERMISSION_TOOL_NAMES,
  type AuthorizationContext,
  type WorkspaceKind,
} from "@/lib/permissions";
import type { ToolDefinition, ToolExecutionContext } from "@/lib/toolCalling";
import type { StructuredToolOutput, ToolMetadata } from "@/tools/registry";
import { resolveAutomationContext } from "@/lib/automation/context";
import {
  createAutomationWorkflow,
  draftFromProposal,
  listAutomationWorkflows,
} from "@/lib/automation/engine";
import { proposeAutomationWorkflow } from "@/lib/automation/proposal";
import { canonicalJson } from "@/lib/automation/validation";
import type { AutomationWorkflowProposal } from "@/lib/automation/types";

export const PROPOSE_AUTOMATION_WORKFLOW_TOOL_NAME =
  AUTOMATION_PERMISSION_TOOL_NAMES.proposeWorkflow;
export const LIST_AUTOMATION_WORKFLOWS_TOOL_NAME =
  AUTOMATION_PERMISSION_TOOL_NAMES.listWorkflows;
export const PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME =
  AUTOMATION_PERMISSION_TOOL_NAMES.prepareWorkflow;

type FailureCode = "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "EXECUTION_FAILED";

function functionDefinition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[]
): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required: [...required],
        additionalProperties: false,
      },
    },
  };
}

function failure(
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>
): StructuredToolOutput {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authFromContext(
  context: ToolExecutionContext
): AuthorizationContext | undefined {
  return context.auth as AuthorizationContext | undefined;
}

function parseArguments(rawArguments: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function boundString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

export const PROPOSE_AUTOMATION_WORKFLOW_TOOL = functionDefinition(
  PROPOSE_AUTOMATION_WORKFLOW_TOOL_NAME,
  "Turn a plain-language automation description into a validated, structured workflow proposal. Does not save or run anything.",
  {
    description: {
      type: "string",
      description:
        "Plain-language description including a trigger and a supported internal action.",
      minLength: 10,
      maxLength: 500,
    },
    name: {
      type: "string",
      description: "Optional workflow name.",
      minLength: 1,
      maxLength: 120,
    },
  },
  ["description"]
);

export const LIST_AUTOMATION_WORKFLOWS_TOOL = functionDefinition(
  LIST_AUTOMATION_WORKFLOWS_TOOL_NAME,
  "List saved automations visible in the current personal or business workspace.",
  {},
  []
);

export const PREPARE_AUTOMATION_WORKFLOW_TOOL = functionDefinition(
  PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
  "Prepare an automation workflow for user approval. This does not save or run the workflow until the user explicitly approves it.",
  {
    description: {
      type: "string",
      description:
        "Plain-language description including a trigger and a supported internal action.",
      minLength: 10,
      maxLength: 500,
    },
    name: {
      type: "string",
      description: "Optional workflow name.",
      minLength: 1,
      maxLength: 120,
    },
  },
  ["description"]
);

export const PROPOSE_AUTOMATION_WORKFLOW_METADATA: ToolMetadata = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
};

export const LIST_AUTOMATION_WORKFLOWS_METADATA: ToolMetadata = {
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
};

export const PREPARE_AUTOMATION_WORKFLOW_METADATA: ToolMetadata = {
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
};

export async function executeProposeAutomationWorkflow(
  rawArguments: string
): Promise<StructuredToolOutput> {
  const args = parseArguments(rawArguments);
  if (!args) return failure("INVALID_ARGUMENTS", "Arguments must be a JSON object.");
  const description = boundString(args.description, 500);
  if (!description) {
    return failure("INVALID_ARGUMENTS", "A description between 1 and 500 characters is required.");
  }
  const name = args.name === undefined ? undefined : boundString(args.name, 120);
  if (args.name !== undefined && !name) {
    return failure("INVALID_ARGUMENTS", "name must be a short, non-empty string.");
  }

  const proposal = proposeAutomationWorkflow({
    description,
    ...(name ? { name } : {}),
  });
  return {
    ok: true,
    data: {
      status: proposal.ok ? "proposal_ready" : "needs_clarification",
      name: proposal.name,
      description: proposal.description,
      proposal: proposal.draft,
      explanation: proposal.explanation,
      missingDetails: proposal.missingDetails,
    },
  };
}

export async function executeListAutomationWorkflows(
  _rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  const auth = authFromContext(context);
  if (!auth) return failure("PERMISSION_DENIED", "Authentication required.");
  const workflows = await listAutomationWorkflows(auth);
  return {
    ok: true,
    data: {
      status: "success",
      workflows: workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        status: workflow.status,
        trigger: workflow.trigger,
        conditions: workflow.conditions,
        actions: workflow.actions,
        nextRunAt: workflow.nextRunAt,
        lastRunAt: workflow.lastRunAt,
      })),
    },
  };
}

function approvalBinding(
  approval: NonNullable<ReturnType<typeof getApprovalRequest>>,
  input: {
    toolName: string;
    context: ToolExecutionContext;
    userId: string;
    workspaceId: string | null;
    workspaceKind: WorkspaceKind;
    resourceId: string;
    rawArguments: string;
  }
): boolean {
  if (approval.toolName !== input.toolName) return false;
  if (approval.userId !== input.userId) return false;
  if (approval.requestId !== input.context.requestId) return false;
  if (approval.resourceId !== input.resourceId) return false;
  if (approval.workspaceKind !== input.workspaceKind) return false;
  if (input.workspaceKind === "personal") {
    if (approval.workspaceId) return false;
  } else if (approval.workspaceId !== input.workspaceId) {
    return false;
  }
  try {
    return (
      canonicalJson(JSON.parse(approval.rawArguments)) ===
      canonicalJson(JSON.parse(input.rawArguments))
    );
  } catch {
    return false;
  }
}

export async function executePrepareAutomationWorkflow(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  const args = parseArguments(rawArguments);
  if (!args) return failure("INVALID_ARGUMENTS", "Arguments must be a JSON object.");
  const description = boundString(args.description, 500);
  if (!description) {
    return failure("INVALID_ARGUMENTS", "A description between 1 and 500 characters is required.");
  }
  const name = args.name === undefined ? undefined : boundString(args.name, 120);
  if (args.name !== undefined && !name) {
    return failure("INVALID_ARGUMENTS", "name must be a short, non-empty string.");
  }
  const auth = authFromContext(context);
  if (!auth) return failure("PERMISSION_DENIED", "Authentication required.");

  const automationContext = await resolveAutomationContext(auth);
  const resourceId =
    automationContext.scope === "workspace"
      ? automationContext.workspaceId ?? "workspace"
      : "personal";
  const proposal = proposeAutomationWorkflow({
    description,
    ...(name ? { name } : {}),
  });

  if (context.approvalId) {
    const approval = getApprovalRequest(context.approvalId);
    if (!approval) return failure("EXECUTION_FAILED", "Approval request was not found.");
    if (approval.status === "executed" && isRecord(approval.executionResult)) {
      return { ok: true, data: approval.executionResult };
    }
    if (
      !approvalBinding(approval, {
        toolName: PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
        context,
        userId: automationContext.actorUserId,
        workspaceId: automationContext.workspaceId,
        workspaceKind: automationContext.scope === "workspace" ? "shared" : "personal",
        resourceId,
        rawArguments,
      })
    ) {
      return failure("PERMISSION_DENIED", "Approval binding is invalid.");
    }
    if (approval.status !== "approved") {
      return failure("PERMISSION_DENIED", "This approval has not been granted.");
    }

    try {
      beginApprovalExecution(approval.id);
      const approvedProposal: AutomationWorkflowProposal = proposeAutomationWorkflow(
        JSON.parse(approval.rawArguments)
      );
      if (!approvedProposal.ok) {
        markApprovalFailed(approval.id, "The approved proposal is no longer valid.");
        return failure("INVALID_ARGUMENTS", "The approved proposal is no longer valid.");
      }
      const workflow = await createAutomationWorkflow(
        auth,
        draftFromProposal(approvedProposal)
      );
      const result = {
        status: "executed",
        workflow: {
          id: workflow.id,
          name: workflow.name,
          status: workflow.status,
          trigger: workflow.trigger,
          actions: workflow.actions,
        },
        explanation: approvedProposal.explanation,
      };
      markApprovalExecuted(approval.id, result);
      return { ok: true, data: result };
    } catch (error) {
      return failure(
        "EXECUTION_FAILED",
        error instanceof Error ? error.message : "The approved workflow could not be saved."
      );
    }
  }

  if (!proposal.ok) {
    return failure("INVALID_ARGUMENTS", "The automation needs more detail.", {
      explanation: proposal.explanation,
      missingDetails: proposal.missingDetails,
    });
  }

  const approval = createApprovalRequest({
    requestId: context.requestId,
    toolName: PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
    rawArguments,
    summary: `Save automation "${proposal.name}"? ${proposal.explanation.join(" ")}`,
    details: {
      name: proposal.name,
      trigger: proposal.draft?.trigger,
      conditions: proposal.draft?.conditions,
      actions: proposal.draft?.actions,
      explanation: proposal.explanation,
      requiresApproval: true,
    },
    userId: automationContext.actorUserId,
    resourceId,
    workspaceId: automationContext.workspaceId ?? undefined,
    workspaceKind: automationContext.scope === "workspace" ? "shared" : "personal",
  });

  return {
    ok: true,
    data: {
      status: "pending_approval",
      approvalId: approval.id,
      summary: approval.summary,
      details: approval.details,
      nextStep: "Ask the user to approve this request, then call this tool again with the approval id supplied by the server.",
    },
  };
}
