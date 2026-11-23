import { automationApiError } from "@/lib/automation/api";
import { proposeAutomationWorkflow } from "@/lib/automation/proposal";
import { AutomationError } from "@/lib/automation/errors";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";

export async function POST(request: Request): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.automation, {
    userId: auth.userId,
    workspaceId: auth.workspaceId ?? null,
  });
  if (limited) return limited;
  try {
    const body = await request.json().catch(() => null);
    const proposal = proposeAutomationWorkflow(body);
    if (!proposal.ok) {
      return Response.json(
        {
          error: "The automation description needs more detail.",
          name: proposal.name,
          explanation: proposal.explanation,
          missingDetails: proposal.missingDetails,
        },
        { status: 400 }
      );
    }
    return Response.json({ proposal });
  } catch (error) {
    return automationApiError(
      error instanceof Error ? error : new AutomationError(400, "INVALID_REQUEST", "Invalid request.")
    );
  }
}
