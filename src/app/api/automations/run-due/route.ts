import { automationApiError } from "@/lib/automation/api";
import { processDueAutomations } from "@/lib/automation/engine";
import { getActiveProjectManagementAuth } from "@/lib/workspace/projectManagementAuth";

export async function POST(): Promise<Response> {
  let auth;
  try {
    ({ auth } = await getActiveProjectManagementAuth());
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const executions = await processDueAutomations(auth);
    return Response.json({ executions, processed: executions.length });
  } catch (error) {
    return automationApiError(error);
  }
}
