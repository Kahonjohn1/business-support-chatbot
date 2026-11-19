import { apiError, apiErrorFromException } from "@/lib/http/api";
import { requireEmployeeApi } from "@/lib/workspace/server";

export async function POST(): Promise<Response> {
  try {
    await requireEmployeeApi();
    return apiError(403, "Company creation is disabled in the Marque workspace.");
  } catch (error) {
    return apiErrorFromException(error);
  }
}
