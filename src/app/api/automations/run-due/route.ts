import { automationApiError } from "@/lib/automation/api";
import { processScheduledAutomations } from "@/lib/automation/scheduler";
import { authenticateSchedulerRequest } from "@/lib/automation/schedulerAuth";

export async function POST(request: Request): Promise<Response> {
  return handleRunDuePost(request);
}

export async function handleRunDuePost(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = authenticateSchedulerRequest(request);
  } catch (error) {
    return automationApiError(error);
  }
  try {
    const executions = await processScheduledAutomations(secret);
    return Response.json({ executions, processed: executions.length });
  } catch (error) {
    return automationApiError(error);
  }
}
