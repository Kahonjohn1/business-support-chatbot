import { handleApprovalDecision } from "@/lib/approvalDecision";
import { apiErrorFromException } from "@/lib/http/api";
import type { AuthorizationContext } from "@/lib/permissions";
import {
  CREATE_PROJECT_TOOL_NAME,
  UPDATE_PROJECT_TOOL_NAME,
} from "@/tools/projectStatusTool";
import {
  CREATE_PROJECT_TASK_TOOL_NAME,
  UPDATE_PROJECT_TASK_TOOL_NAME,
} from "@/tools/tasksTool";
import {
  PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
} from "@/tools/integrationTools";
import { PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME } from "@/tools/automationTools";

const LEGACY_APPROVAL_OPTIONS = {
  allowedToolNames: [
    CREATE_PROJECT_TOOL_NAME,
    UPDATE_PROJECT_TOOL_NAME,
    CREATE_PROJECT_TASK_TOOL_NAME,
    UPDATE_PROJECT_TASK_TOOL_NAME,
    PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
    PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
    PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
  ],
  requireOwnership: true,
} as const;

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

export function handleApprovalPost(
  request: Request,
  authContext: AuthorizationContext | undefined
): Promise<Response> {
  return handleApprovalDecision(request, authContext, LEGACY_APPROVAL_OPTIONS);
}

export async function GET(): Promise<Response> {
  return Response.json(
    { error: "Audit logs are not exposed by this endpoint." },
    { status: 403 }
  );
}
