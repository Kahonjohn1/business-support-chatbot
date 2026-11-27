export const EMPLOYEE_INVITE_METADATA_KEY = "employee_invite";
export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type InvitationEmailStatus = "sent" | "not_sent" | "unknown" | "not_needed";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }

  return "Unknown error";
}

export function redactForServerLog(value: unknown): string {
  return errorMessage(value)
    .replace(/(token_hash|token|password|code)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .slice(0, 400);
}

export function logInvitationError(stage: string, error: unknown): void {
  console.error(`[employee-onboarding] ${stage}: ${redactForServerLog(error)}`);
}

export function isMissingRpcError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();

  return [
    "could not find the function",
    "does not exist",
    "schema cache",
    "permission denied",
    "not permitted",
  ].some((fragment) => message.includes(fragment));
}

export function isEmployeeInviteUser(
  user: { user_metadata?: unknown } | null | undefined
): boolean {
  const metadata = user?.user_metadata as Record<string, unknown> | undefined;
  return metadata?.[EMPLOYEE_INVITE_METADATA_KEY] === true;
}
