import { WorkspaceAccessError } from "@/lib/workspace/errors";

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function apiErrorFromException(error: unknown): Response {
  if (error instanceof WorkspaceAccessError) {
    return apiError(error.status, error.message);
  }
  return apiError(500, "Something went wrong. Please try again.");
}
