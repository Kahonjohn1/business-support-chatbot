import {
  beginApprovalExecutionRecord,
  completeApprovalExecutionRecord,
  createApprovalRecord,
  getApprovalRecord,
} from "@/lib/approvalWorkflow";
import {
  findIntegrationConnection,
  recordIntegrationAudit,
  type IntegrationContext,
} from "@/lib/integrations/data";
import { IntegrationError } from "@/lib/integrations/errors";
import {
  checkCalendarAvailability,
  listCalendarEvents,
  readGmailMessage,
  searchGmailMessages,
} from "@/lib/integrations/googleApi";
import { getProviderAccessToken } from "@/lib/integrations/connections";
import { INTEGRATION_PERMISSION_TOOL_NAMES } from "@/lib/permissions";
import type { IntegrationConnectionRecord } from "@/lib/integrations/types";
import type { ToolDefinition, ToolExecutionContext } from "@/lib/toolCalling";
import type { StructuredToolOutput, ToolMetadata } from "@/tools/registry";

export const SEARCH_INTEGRATION_EMAIL_TOOL_NAME = "search_integration_email";
export const READ_INTEGRATION_EMAIL_TOOL_NAME = "read_integration_email";
export const LIST_INTEGRATION_CALENDAR_EVENTS_TOOL_NAME = "list_integration_calendar_events";
export const CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL_NAME =
  "check_integration_calendar_availability";
export const PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME = "prepare_integration_email_draft";
export const PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME = "prepare_integration_calendar_event";

type FailureCode = "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "EXECUTION_FAILED";

interface ParsedArguments {
  readonly [key: string]: string | number | readonly string[];
}

const functionDefinition = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[]
): ToolDefinition => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required: [...required],
      additionalProperties: false,
    },
  },
});

const boundedString = (description: string, maxLength: number) => ({
  type: "string",
  description,
  minLength: 1,
  maxLength,
});

export const SEARCH_INTEGRATION_EMAIL_TOOL = functionDefinition(
  SEARCH_INTEGRATION_EMAIL_TOOL_NAME,
  "Search the connected mailbox using a short Gmail query. Never accepts tokens, URLs, user IDs, or workspace IDs.",
  {
    query: boundedString("Gmail search query, for example: from:client@example.com", 300),
    maxResults: {
      type: "integer",
      description: "Maximum number of results to return, from 1 to 20.",
      minimum: 1,
      maximum: 20,
    },
  },
  ["query"]
);

export const READ_INTEGRATION_EMAIL_TOOL = functionDefinition(
  READ_INTEGRATION_EMAIL_TOOL_NAME,
  "Read safe metadata and snippet for one message from the connected mailbox.",
  {
    messageId: boundedString("Message id returned by a mailbox search.", 200),
  },
  ["messageId"]
);

export const LIST_INTEGRATION_CALENDAR_EVENTS_TOOL = functionDefinition(
  LIST_INTEGRATION_CALENDAR_EVENTS_TOOL_NAME,
  "List events from the connected primary calendar within a bounded ISO date-time range.",
  {
    timeMin: boundedString("Start of the range as an ISO date-time string.", 40),
    timeMax: boundedString("End of the range as an ISO date-time string.", 40),
    maxResults: {
      type: "integer",
      description: "Maximum number of events to return, from 1 to 20.",
      minimum: 1,
      maximum: 20,
    },
  },
  ["timeMin", "timeMax"]
);

export const CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL = functionDefinition(
  CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL_NAME,
  "Check busy intervals on the connected primary calendar within a bounded ISO date-time range.",
  {
    timeMin: boundedString("Start of the range as an ISO date-time string.", 40),
    timeMax: boundedString("End of the range as an ISO date-time string.", 40),
  },
  ["timeMin", "timeMax"]
);

export const PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL = functionDefinition(
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
  "Prepare an email draft for user approval. This does not send email or write to the provider.",
  {
    to: boundedString("Recipient email address.", 254),
    subject: boundedString("Draft subject.", 200),
    body: boundedString("Draft body.", 4000),
  },
  ["to", "subject", "body"]
);

export const PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL = functionDefinition(
  PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
  "Prepare a calendar event draft for user approval. This does not create an event.",
  {
    title: boundedString("Event title.", 200),
    start: boundedString("Event start as an ISO date-time string.", 40),
    end: boundedString("Event end as an ISO date-time string.", 40),
    description: {
      type: "string",
      description: "Optional event notes.",
      minLength: 0,
      maxLength: 2000,
    },
  },
  ["title", "start", "end"]
);

const READ_METADATA: ToolMetadata = Object.freeze({
  readOnly: true,
  destructive: false,
  requiresAuth: true,
  idempotent: true,
  requiresApproval: false,
});

const PREPARE_METADATA: ToolMetadata = Object.freeze({
  readOnly: false,
  destructive: false,
  requiresAuth: true,
  idempotent: false,
  requiresApproval: true,
});

export const SEARCH_INTEGRATION_EMAIL_METADATA = READ_METADATA;
export const READ_INTEGRATION_EMAIL_METADATA = READ_METADATA;
export const LIST_INTEGRATION_CALENDAR_EVENTS_METADATA = READ_METADATA;
export const CHECK_INTEGRATION_CALENDAR_AVAILABILITY_METADATA = READ_METADATA;
export const PREPARE_INTEGRATION_EMAIL_DRAFT_METADATA = PREPARE_METADATA;
export const PREPARE_INTEGRATION_CALENDAR_EVENT_METADATA = PREPARE_METADATA;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(code: FailureCode, message: string): StructuredToolOutput {
  return { ok: false, error: { code, message } };
}

function success(data: unknown): StructuredToolOutput {
  return { ok: true, data };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseArguments(
  rawArguments: string,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  maxLength: number
): ParsedArguments {
  if (typeof rawArguments !== "string" || rawArguments.length > maxLength) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Tool arguments are invalid.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new IntegrationError(400, "INVALID_REQUEST", "Tool arguments are invalid.");
  }
  if (!isRecord(parsed)) {
    throw new IntegrationError(400, "INVALID_REQUEST", "Tool arguments are invalid.");
  }
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.includes(key)) {
      throw new IntegrationError(400, "INVALID_REQUEST", `Unknown argument "${key}".`);
    }
  }
  for (const key of requiredKeys) {
    if (!(key in parsed)) {
      throw new IntegrationError(400, "INVALID_REQUEST", `Missing argument "${key}".`);
    }
  }
  return parsed as ParsedArguments;
}

function readText(
  args: ParsedArguments,
  key: string,
  maxLength: number,
  options: { optional?: boolean } = {}
): string | null {
  const value = args[key];
  if (value === undefined && options.optional) return null;
  if (typeof value !== "string") {
    throw new IntegrationError(400, "INVALID_REQUEST", `${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed && !options.optional) {
    throw new IntegrationError(400, "INVALID_REQUEST", `${key} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new IntegrationError(400, "INVALID_REQUEST", `${key} is too long.`);
  }
  return trimmed || null;
}

function readInteger(
  args: ParsedArguments,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new IntegrationError(400, "INVALID_REQUEST", `${key} is invalid.`);
  }
  return value;
}

function readIsoDate(args: ParsedArguments, key: string): string {
  const value = readText(args, key, 40) ?? "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new IntegrationError(400, "INVALID_REQUEST", `${key} must be an ISO date-time.`);
  }
  return new Date(timestamp).toISOString();
}

function mapToolError(error: unknown): StructuredToolOutput {
  if (error instanceof IntegrationError) {
    if (error.status === 403) return failure("PERMISSION_DENIED", error.message);
    return failure("EXECUTION_FAILED", error.message);
  }
  return failure("EXECUTION_FAILED", "The integration operation failed.");
}

async function auditToolAction(
  context: IntegrationContext | undefined,
  provider: "gmail" | "google_calendar",
  action: string,
  outcome: "success" | "failure" | "pending",
  details?: Record<string, unknown>
): Promise<void> {
  if (!context) return;
  await recordIntegrationAudit(context, { provider, action, outcome, details });
}

function assertApprovalBinding(
  approval: Awaited<ReturnType<typeof getApprovalRecord>>,
  input: {
    toolName: string;
    context: ToolExecutionContext;
    contextResult: IntegrationContext;
    connection: IntegrationConnectionRecord;
    rawArguments: string;
  }
): boolean {
  if (!approval) return false;
  if (approval.toolName !== input.toolName) return false;
  if (approval.userId !== input.contextResult.userId) return false;
  if (approval.requestId !== input.context.requestId) return false;
  if (approval.resourceId !== input.connection.id) return false;
  if (approval.workspaceKind !== input.contextResult.auth.workspaceKind) return false;
  if (input.contextResult.scope === "workspace") {
    if (approval.workspaceId !== input.contextResult.workspaceId) return false;
  } else if (approval.workspaceId) {
    return false;
  }
  try {
    const approvedArgs = JSON.parse(approval.rawArguments) as unknown;
    const currentArgs = JSON.parse(input.rawArguments) as unknown;
    return canonicalJson(approvedArgs) === canonicalJson(currentArgs);
  } catch {
    return false;
  }
}

async function executeReadTool(
  rawArguments: string,
  context: ToolExecutionContext,
  options: {
    provider: "gmail" | "google_calendar";
    toolName: string;
    allowedKeys: readonly string[];
    requiredKeys: readonly string[];
    run: (token: string, args: ParsedArguments) => Promise<unknown>;
  }
): Promise<StructuredToolOutput> {
  try {
    const args = parseArguments(rawArguments, options.allowedKeys, options.requiredKeys, 4000);
    const { token, context: integrationContext } = await getProviderAccessToken(
      context.auth,
      options.provider,
      INTEGRATION_PERMISSION_TOOL_NAMES.useRead
    );
    const result = await options.run(token, args);
    await auditToolAction(integrationContext, options.provider, options.toolName, "success");
    const payload = isRecord(result)
      ? result
      : Array.isArray(result)
        ? { items: result }
        : { result };
    return success({ provider: options.provider, ...payload });
  } catch (error) {
    return mapToolError(error);
  }
}

export async function executeSearchIntegrationEmail(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executeReadTool(rawArguments, context, {
    provider: "gmail",
    toolName: SEARCH_INTEGRATION_EMAIL_TOOL_NAME,
    allowedKeys: ["query", "maxResults"],
    requiredKeys: ["query"],
    run: (token, args) =>
      searchGmailMessages(
        token,
        readText(args, "query", 300) ?? "",
        readInteger(args, "maxResults", 10, 1, 20)
      ),
  });
}

export async function executeReadIntegrationEmail(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executeReadTool(rawArguments, context, {
    provider: "gmail",
    toolName: READ_INTEGRATION_EMAIL_TOOL_NAME,
    allowedKeys: ["messageId"],
    requiredKeys: ["messageId"],
    run: (token, args) => readGmailMessage(token, readText(args, "messageId", 200) ?? ""),
  });
}

export async function executeListIntegrationCalendarEvents(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executeReadTool(rawArguments, context, {
    provider: "google_calendar",
    toolName: LIST_INTEGRATION_CALENDAR_EVENTS_TOOL_NAME,
    allowedKeys: ["timeMin", "timeMax", "maxResults"],
    requiredKeys: ["timeMin", "timeMax"],
    run: (token, args) =>
      listCalendarEvents(
        token,
        readIsoDate(args, "timeMin"),
        readIsoDate(args, "timeMax"),
        readInteger(args, "maxResults", 10, 1, 20)
      ),
  });
}

export async function executeCheckIntegrationCalendarAvailability(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executeReadTool(rawArguments, context, {
    provider: "google_calendar",
    toolName: CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL_NAME,
    allowedKeys: ["timeMin", "timeMax"],
    requiredKeys: ["timeMin", "timeMax"],
    run: (token, args) =>
      checkCalendarAvailability(token, readIsoDate(args, "timeMin"), readIsoDate(args, "timeMax")),
  });
}

interface PrepareToolOptions {
  readonly provider: "gmail" | "google_calendar";
  readonly toolName: string;
  readonly allowedKeys: readonly string[];
  readonly requiredKeys: readonly string[];
  readonly summary: string;
  readonly buildPayload: (args: ParsedArguments) => Record<string, unknown>;
}

async function executePrepareTool(
  rawArguments: string,
  context: ToolExecutionContext,
  options: PrepareToolOptions
): Promise<StructuredToolOutput> {
  try {
    const args = parseArguments(rawArguments, options.allowedKeys, options.requiredKeys, 6000);
    const { context: integrationContext, connection } = await findIntegrationConnection(
      context.auth,
      options.provider,
      INTEGRATION_PERMISSION_TOOL_NAMES.prepareAction
    );
    if (
      connection.status === "disconnected" ||
      connection.status === "revoked" ||
      connection.status === "error" ||
      connection.status === "reconnect_required"
    ) {
      throw new IntegrationError(401, "RECONNECT_REQUIRED", "This integration needs to be reconnected.");
    }

    if (context.approvalId) {
      const approval = await getApprovalRecord(context.approvalId);
      if (!approval) {
        return failure("PERMISSION_DENIED", "The approval request was not found.");
      }
      if (approval.status === "executed") {
        return success(
          (approval.executionResult as Record<string, unknown>) ?? {
            status: "executed",
            notice: "The prepared operation was already returned.",
          }
        );
      }
      if (
        !        assertApprovalBinding(approval, {
          toolName: options.toolName,
          context,
          contextResult: integrationContext,
          connection,
          rawArguments,
        }) ||
        approval.status !== "approved"
      ) {
        return failure("PERMISSION_DENIED", "The approval does not match this operation.");
      }

      await beginApprovalExecutionRecord(context.approvalId);
      const data = {
        status: "executed" as const,
        kind: options.toolName,
        provider: options.provider,
        payload: options.buildPayload(args),
        notice: "Prepared for review. No message was sent and no event was created.",
      };
      await completeApprovalExecutionRecord(context.approvalId, data);
      await auditToolAction(integrationContext, options.provider, options.toolName, "success");
      return success(data);
    }

    const approval = await createApprovalRecord({
      requestId: context.requestId,
      toolName: options.toolName,
      rawArguments,
      summary: options.summary,
      details: {
        provider: options.provider,
        scope: integrationContext.scope,
        target: options.buildPayload(args),
      },
      userId: integrationContext.userId,
      resourceId: connection.id,
      ...(integrationContext.scope === "workspace"
        ? { workspaceId: integrationContext.workspaceId ?? undefined }
        : {}),
      workspaceKind: integrationContext.auth.workspaceKind,
    });
    await auditToolAction(integrationContext, options.provider, options.toolName, "pending");
    return success({
      status: "pending_approval" as const,
      approvalId: approval.id,
      action: options.toolName,
      summary: options.summary,
      details: approval.details,
      notice: "This operation requires explicit user approval before the draft is prepared.",
    });
  } catch (error) {
    if (error instanceof IntegrationError && error.code === "RECONNECT_REQUIRED") {
      return failure("EXECUTION_FAILED", error.message);
    }
    return mapToolError(error);
  }
}

export async function executePrepareIntegrationEmailDraft(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executePrepareTool(rawArguments, context, {
    provider: "gmail",
    toolName: PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
    allowedKeys: ["to", "subject", "body"],
    requiredKeys: ["to", "subject", "body"],
    summary: "Prepare an email draft for review.",
    buildPayload: (args) => ({
      to: readText(args, "to", 254),
      subject: readText(args, "subject", 200),
      body: readText(args, "body", 4000),
    }),
  });
}

export async function executePrepareIntegrationCalendarEvent(
  rawArguments: string,
  context: ToolExecutionContext
): Promise<StructuredToolOutput> {
  return executePrepareTool(rawArguments, context, {
    provider: "google_calendar",
    toolName: PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
    allowedKeys: ["title", "start", "end", "description"],
    requiredKeys: ["title", "start", "end"],
    summary: "Prepare a calendar event for review.",
    buildPayload: (args) => ({
      title: readText(args, "title", 200),
      start: readIsoDate(args, "start"),
      end: readIsoDate(args, "end"),
      description: readText(args, "description", 2000, { optional: true }),
    }),
  });
}
