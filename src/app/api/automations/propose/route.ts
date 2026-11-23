import { automationApiError } from "@/lib/automation/api";
import { proposeAutomationWorkflow } from "@/lib/automation/proposal";
import { AutomationError } from "@/lib/automation/errors";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

export async function POST(request: Request): Promise<Response> {
  try {
    await getActiveProjectManagementAuth();
  } catch (error) {
    return automationApiError(error);
  }
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
