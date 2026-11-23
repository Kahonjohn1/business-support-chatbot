import { apiError } from "@/lib/http/api";
import {
  AutomationError,
  automationErrorFromException,
} from "@/lib/automation/errors";

export function automationApiError(error: unknown): Response {
  const normalized: AutomationError = automationErrorFromException(error);
  return apiError(normalized.status, normalized.message);
}
