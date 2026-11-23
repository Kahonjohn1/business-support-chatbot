export type AutomationErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LIMIT_EXCEEDED"
  | "STORAGE_UNAVAILABLE"
  | "UNSUPPORTED_WORKFLOW";

export class AutomationError extends Error {
  readonly status: number;
  readonly code: AutomationErrorCode;

  constructor(
    status: number,
    code: AutomationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AutomationError";
    this.status = status;
    this.code = code;
  }
}

export function automationErrorFromException(error: unknown): AutomationError {
  if (error instanceof AutomationError) return error;
  if (error instanceof Error) {
    return new AutomationError(500, "STORAGE_UNAVAILABLE", error.message);
  }
  return new AutomationError(500, "STORAGE_UNAVAILABLE", "Automation operation failed.");
}
