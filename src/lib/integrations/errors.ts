export type IntegrationErrorCode =
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_NOT_CONFIGURED"
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "INVALID_REQUEST"
  | "NOT_CONNECTED"
  | "RECONNECT_REQUIRED"
  | "TOKEN_EXCHANGE_FAILED"
  | "PROVIDER_ERROR"
  | "STORAGE_UNAVAILABLE";

export class IntegrationError extends Error {
  readonly status: number;
  readonly code: IntegrationErrorCode;

  constructor(status: number, code: IntegrationErrorCode, message: string) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
    this.code = code;
  }
}

export function integrationErrorResponse(error: unknown): Response {
  if (error instanceof IntegrationError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return Response.json(
    { error: "The integration operation failed. Please try again." },
    { status: 500 }
  );
}
