import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { AutomationError } from "@/lib/automation/errors";

export const SCHEDULER_SECRET_HEADER = "x-scheduler-secret";
export const MIN_SCHEDULER_SECRET_LENGTH = 32;

export function getSchedulerSecret(): string {
  const secret = process.env.AUTOMATION_SCHEDULER_SECRET?.trim() ?? "";
  if (secret.length < MIN_SCHEDULER_SECRET_LENGTH) {
    throw new AutomationError(
      503,
      "STORAGE_UNAVAILABLE",
      "The automation scheduler is not configured."
    );
  }
  return secret;
}

export function authenticateSchedulerRequest(request: Request): string {
  const expected = getSchedulerSecret();
  const provided = request.headers.get(SCHEDULER_SECRET_HEADER) ?? "";
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  if (!provided || !timingSafeEqual(providedDigest, expectedDigest)) {
    throw new AutomationError(
      401,
      "FORBIDDEN",
      "Scheduler authentication required."
    );
  }
  return expected;
}
