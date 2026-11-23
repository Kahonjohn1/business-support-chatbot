import { handleApprovalDecision } from "@/lib/approvalDecision";
import { apiErrorFromException } from "@/lib/http/api";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
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

const ACTIVE_APPROVAL_OPTIONS = {
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
    ({ auth: authContext } = await getActiveProjectManagementAuth());
  } catch (error) {
    return apiErrorFromException(error);
  }
  return handleActiveApprovalPost(request, authContext);
}

export function handleActiveApprovalPost(
  request: Request,
  authContext: AuthorizationContext | undefined
): Promise<Response> {
  return handleApprovalDecision(request, authContext, ACTIVE_APPROVAL_OPTIONS);
}

export async function GET(): Promise<Response> {
  return Response.json(
    { error: "Audit logs are not exposed by this endpoint." },
    { status: 403 }
  );
}
