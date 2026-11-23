import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionMeta,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  ToolExecutionResult,
} from "@/lib/toolCalling";
import {
  CREATE_PROJECT_TOOL,
  CREATE_PROJECT_TOOL_NAME,
  CREATE_PROJECT_METADATA,
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_TOOL_NAME,
  GET_PROJECT_STATUS_METADATA,
  LIST_PROJECTS_TOOL,
  LIST_PROJECTS_TOOL_NAME,
  LIST_PROJECTS_METADATA,
  UPDATE_PROJECT_TOOL,
  UPDATE_PROJECT_TOOL_NAME,
  UPDATE_PROJECT_METADATA,
  executeCreateProject,
  executeGetProjectStatus,
  executeListProjects,
  executeUpdateProject,
} from "@/tools/projectStatusTool";
import {
  CREATE_PROJECT_TASK_TOOL,
  CREATE_PROJECT_TASK_TOOL_NAME,
  CREATE_PROJECT_TASK_METADATA,
  UPDATE_PROJECT_TASK_TOOL,
  UPDATE_PROJECT_TASK_TOOL_NAME,
  UPDATE_PROJECT_TASK_METADATA,
  executeCreateProjectTask,
  executeListProjectTasks,
  executeUpdateProjectTask,
  LIST_PROJECT_TASKS_TOOL,
  LIST_PROJECT_TASKS_TOOL_NAME,
  LIST_PROJECT_TASKS_METADATA,
} from "@/tools/tasksTool";
import {
  CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL,
  CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL_NAME,
  CHECK_INTEGRATION_CALENDAR_AVAILABILITY_METADATA,
  LIST_INTEGRATION_CALENDAR_EVENTS_TOOL,
  LIST_INTEGRATION_CALENDAR_EVENTS_TOOL_NAME,
  LIST_INTEGRATION_CALENDAR_EVENTS_METADATA,
  PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL,
  PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
  PREPARE_INTEGRATION_CALENDAR_EVENT_METADATA,
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL,
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
  PREPARE_INTEGRATION_EMAIL_DRAFT_METADATA,
  READ_INTEGRATION_EMAIL_TOOL,
  READ_INTEGRATION_EMAIL_TOOL_NAME,
  READ_INTEGRATION_EMAIL_METADATA,
  SEARCH_INTEGRATION_EMAIL_TOOL,
  SEARCH_INTEGRATION_EMAIL_TOOL_NAME,
  SEARCH_INTEGRATION_EMAIL_METADATA,
  executeCheckIntegrationCalendarAvailability,
  executeListIntegrationCalendarEvents,
  executePrepareIntegrationCalendarEvent,
  executePrepareIntegrationEmailDraft,
  executeReadIntegrationEmail,
  executeSearchIntegrationEmail,
} from "@/tools/integrationTools";
import {
  LIST_AUTOMATION_WORKFLOWS_METADATA,
  LIST_AUTOMATION_WORKFLOWS_TOOL,
  LIST_AUTOMATION_WORKFLOWS_TOOL_NAME,
  PREPARE_AUTOMATION_WORKFLOW_METADATA,
  PREPARE_AUTOMATION_WORKFLOW_TOOL,
  PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
  PROPOSE_AUTOMATION_WORKFLOW_METADATA,
  PROPOSE_AUTOMATION_WORKFLOW_TOOL,
  PROPOSE_AUTOMATION_WORKFLOW_TOOL_NAME,
  executeListAutomationWorkflows,
  executePrepareAutomationWorkflow,
  executeProposeAutomationWorkflow,
} from "@/tools/automationTools";
import {
  checkPermission,
  hasPermissionPolicy,
  type AuthorizationContext,
} from "@/lib/permissions";
import { persistAuditEvent } from "@/lib/auditLog";

export type {
  ToolExecutionContext,
  ToolExecutionMeta,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  ToolExecutionResult,
};

function auditContextForExecution(ctx: ToolExecutionContext) {
  const auth = ctx.auth as AuthorizationContext | undefined;
  if (auth?.workspaceKind === "shared" && auth.workspaceId) {
    return { workspaceKind: "shared" as const, workspaceId: auth.workspaceId };
  }
  return { workspaceKind: "personal" as const };
}

export interface ToolMetadata {
  /**
   * Whether the tool is read-only and makes no mutations to external or internal state.
   */
  readonly readOnly: boolean;
  /**
   * Whether the tool performs destructive operations (e.g. deletion, overwriting).
   */
  readonly destructive: boolean;
  /**
   * Whether executing the tool requires authentication or elevated permissions.
   */
  readonly requiresAuth: boolean;
  /**
   * Whether repeated identical invocations produce the same result and state.
   */
  readonly idempotent: boolean;
  /**
   * Whether this tool performs protected mutations requiring explicit user approval.
   */
  readonly requiresApproval?: boolean;
}

export const TOOL_ERROR_CODES = [
  "UNKNOWN_TOOL",
  "INVALID_ARGUMENTS",
  "EXECUTION_FAILED",
  "INVALID_RESULT",
  "PERMISSION_DENIED",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export function isValidErrorCode(code: unknown): code is ToolErrorCode {
  return (
    typeof code === "string" &&
    TOOL_ERROR_CODES.includes(code as ToolErrorCode)
  );
}

export interface ToolErrorDetail {
  code: ToolErrorCode;
  message: string;
  details?: unknown;
}

export interface StructuredToolSuccess<T = unknown> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface StructuredToolFailure {
  ok: false;
  error: ToolErrorDetail;
  meta?: Record<string, unknown>;
}

export type StructuredToolOutput<T = unknown> =
  | StructuredToolSuccess<T>
  | StructuredToolFailure;

export type ToolHandler = (
  rawArguments: string,
  context: ToolExecutionContext
) => StructuredToolOutput | Promise<StructuredToolOutput>;

export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler;
  readonly metadata: ToolMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Creates a default execution context when one is omitted.
 */
export function createDefaultExecutionContext(
  overrides?: Partial<ToolExecutionContext>
): ToolExecutionContext {
  return {
    requestId:
      overrides?.requestId?.trim() ||
      `req_${Math.random().toString(36).slice(2, 8)}`,
    toolCallId: overrides?.toolCallId,
    timestamp: overrides?.timestamp ?? Date.now(),
    ...(overrides?.auth ? { auth: overrides.auth } : {}),
    ...(overrides?.approvalId ? { approvalId: overrides.approvalId } : {}),
  };
}

/**
 * Validates the raw return value from a tool handler at runtime before
 * preparing the response for the model.
 */
export function validateToolHandlerResult(
  result: unknown
): StructuredToolOutput {
  if (!isRecord(result)) {
    throw new Error("Tool handler must return a result object.");
  }

  if (result.ok === true) {
    if ("data" in result) {
      if (result.data === undefined) {
        throw new Error(
          "Tool success result must provide a defined 'data' property."
        );
      }
      return {
        ok: true,
        data: result.data,
        meta: isRecord(result.meta) ? result.meta : undefined,
      };
    }

    if (typeof result.content === "string") {
      let parsedData: unknown = result.content;
      try {
        parsedData = JSON.parse(result.content);
      } catch {
        // Plain string content is accepted as data
      }
      return {
        ok: true,
        data: parsedData,
        meta: isRecord(result.meta) ? result.meta : undefined,
      };
    }

    throw new Error(
      "Tool success result must include either 'data' or 'content'."
    );
  }

  if (result.ok === false) {
    if ("error" in result) {
      const err = result.error;
      if (typeof err === "string" && err.trim()) {
        const code =
          typeof result.code === "string" && isValidErrorCode(result.code)
            ? result.code
            : "EXECUTION_FAILED";
        return {
          ok: false,
          error: { code, message: err },
          meta: isRecord(result.meta) ? result.meta : undefined,
        };
      }

      if (
        isRecord(err) &&
        typeof err.message === "string" &&
        err.message.trim()
      ) {
        const code =
          typeof err.code === "string" && isValidErrorCode(err.code)
            ? err.code
            : typeof result.code === "string" && isValidErrorCode(result.code)
              ? result.code
              : "EXECUTION_FAILED";
        return {
          ok: false,
          error: { code, message: err.message, details: err.details },
          meta: isRecord(result.meta) ? result.meta : undefined,
        };
      }
    }

    throw new Error(
      "Tool failure result must include an error message or error object."
    );
  }

  throw new Error("Tool result must have a boolean 'ok' property.");
}

/**
 * Formats a validated tool result for the AI model, ensuring only necessary
 * fields are included and internal implementation details / metadata are omitted.
 */
export function formatToolResultForModel(
  result: StructuredToolOutput | ToolExecutionResult
): string {
  if (result.ok) {
    if ("content" in result && typeof result.content === "string") {
      return result.content;
    }
    const data = "data" in result ? result.data : undefined;
    return typeof data === "string" ? data : JSON.stringify(data);
  }

  const message =
    typeof result.error === "string" ? result.error : result.error.message;
  const code =
    "code" in result && typeof result.code === "string"
      ? result.code
      : "error" in result && isRecord(result.error) && typeof result.error.code === "string"
        ? result.error.code
        : "EXECUTION_FAILED";

  return JSON.stringify({ error: message, code });
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /**
   * Registers a tool. Throws if a tool with the same name is already registered.
   */
  register(tool: RegisteredTool): this {
    const name = tool.definition.function.name;
    if (!name || typeof name !== "string") {
      throw new Error("Tool definition must include a valid function name.");
    }
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, tool);
    return this;
  }

  /**
   * Retrieves a registered tool by its function name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks whether a tool name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns provider-facing tool definitions for all registered tools.
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), (tool) => tool.definition);
  }

  /**
   * Returns all registered tools.
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Resolves and executes a tool through the registry with typed context,
   * server-side permissions enforcement, runtime validation, error codes,
   * and audit logging.
   */
  async execute(
    name: string,
    rawArguments: string,
    context?: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const t0 = Date.now();
    const ctx = context ?? createDefaultExecutionContext();
    const tool = this.tools.get(name);

    if (!tool) {
      const durationMs = Date.now() - t0;
      await persistAuditEvent(
        {
          requestId: ctx.requestId,
          toolName: name,
          operation: "tool_dispatch",
          status: "denied",
          executionOutcome: {
            ok: false,
            code: "UNKNOWN_TOOL",
            durationMs,
          },
        },
        auditContextForExecution(ctx)
      );

      return {
        ok: false,
        error: "Unknown tool. No tool was executed.",
        code: "UNKNOWN_TOOL",
        meta: {
          requestId: ctx.requestId,
          toolCallId: ctx.toolCallId,
          durationMs,
          timestamp: ctx.timestamp ?? t0,
        },
      };
    }

    // Server-side authorization check for protected or policy-backed tools.
    if (tool.metadata.requiresAuth || hasPermissionPolicy(name)) {
      const authContext = ctx.auth as AuthorizationContext | undefined;
      if (typeof authContext?.userId !== "string" || !authContext.userId.trim()) {
        const durationMs = Date.now() - t0;
        await persistAuditEvent(
          {
            requestId: ctx.requestId,
            toolName: name,
            operation: "permission_check",
            status: "denied",
            permissionDecision: {
              permitted: false,
              reason: "Verified user identity is required.",
            },
          },
          auditContextForExecution(ctx)
        );

        return {
          ok: false,
          error: "Verified user identity is required for this operation.",
          code: "PERMISSION_DENIED",
          meta: {
            requestId: ctx.requestId,
            toolCallId: ctx.toolCallId,
            durationMs,
            timestamp: ctx.timestamp ?? t0,
          },
        };
      }

      const permResult = checkPermission(name, authContext);
      if (!permResult.permitted) {
        const durationMs = Date.now() - t0;
        await persistAuditEvent(
          {
            requestId: ctx.requestId,
            toolName: name,
            operation: "permission_check",
            status: "denied",
            permissionDecision: {
              permitted: false,
              role: authContext?.role,
              requiredPermission: permResult.requiredPermission,
              reason: permResult.reason,
            },
          },
          auditContextForExecution(ctx)
        );

        return {
          ok: false,
          error: permResult.reason || "Permission denied for this operation.",
          code: "PERMISSION_DENIED",
          meta: {
            requestId: ctx.requestId,
            toolCallId: ctx.toolCallId,
            durationMs,
            timestamp: ctx.timestamp ?? t0,
          },
        };
      }

      await persistAuditEvent(
        {
          requestId: ctx.requestId,
          toolName: name,
          operation: "permission_check",
          status: "permitted",
          permissionDecision: {
            permitted: true,
            role: authContext?.role,
            requiredPermission: permResult.requiredPermission,
          },
        },
        auditContextForExecution(ctx)
      );
    }

    let rawHandlerResult: unknown;
    try {
      rawHandlerResult = await tool.handler(rawArguments, ctx);
    } catch (error) {
      const durationMs = Date.now() - t0;
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The tool could not be executed.";

      await persistAuditEvent(
        {
          requestId: ctx.requestId,
          toolName: name,
          operation: "tool_execution",
          status: "failed",
          executionOutcome: {
            ok: false,
            code: "EXECUTION_FAILED",
            durationMs,
          },
        },
        auditContextForExecution(ctx)
      );

      return {
        ok: false,
        error: errorMessage,
        code: "EXECUTION_FAILED",
        meta: {
          requestId: ctx.requestId,
          toolCallId: ctx.toolCallId,
          durationMs,
          timestamp: ctx.timestamp ?? t0,
        },
      };
    }

    let validated: StructuredToolOutput;
    try {
      validated = validateToolHandlerResult(rawHandlerResult);
    } catch {
      const durationMs = Date.now() - t0;
      await persistAuditEvent(
        {
          requestId: ctx.requestId,
          toolName: name,
          operation: "tool_execution",
          status: "failed",
          executionOutcome: {
            ok: false,
            code: "INVALID_RESULT",
            durationMs,
          },
        },
        auditContextForExecution(ctx)
      );

      return {
        ok: false,
        error: "The tool produced an invalid result structure.",
        code: "INVALID_RESULT",
        meta: {
          requestId: ctx.requestId,
          toolCallId: ctx.toolCallId,
          durationMs,
          timestamp: ctx.timestamp ?? t0,
        },
      };
    }

    const durationMs = Date.now() - t0;
    await persistAuditEvent(
      {
        requestId: ctx.requestId,
        toolName: name,
        operation: "tool_execution",
        status: validated.ok ? "executed" : "failed",
        executionOutcome: {
          ok: validated.ok,
          code: validated.ok ? undefined : validated.error.code,
          durationMs,
        },
      },
      auditContextForExecution(ctx)
    );

    if (validated.ok) {
      return {
        ok: true,
        content: formatToolResultForModel(validated),
        data: validated.data,
        meta: {
          requestId: ctx.requestId,
          toolCallId: ctx.toolCallId,
          durationMs,
          timestamp: ctx.timestamp ?? t0,
        },
      };
    }

    return {
      ok: false,
      error: validated.error.message,
      code: validated.error.code,
      meta: {
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        durationMs,
        timestamp: ctx.timestamp ?? t0,
      },
    };
  }
}

/** Central tool registry instance for the application. */
export const toolRegistry = new ToolRegistry();

// Register the personal project tools.
toolRegistry.register({
  definition: CREATE_PROJECT_TOOL,
  handler: executeCreateProject,
  metadata: CREATE_PROJECT_METADATA,
});

toolRegistry.register({
  definition: UPDATE_PROJECT_TOOL,
  handler: executeUpdateProject,
  metadata: UPDATE_PROJECT_METADATA,
});

toolRegistry.register({
  definition: GET_PROJECT_STATUS_TOOL,
  handler: executeGetProjectStatus,
  metadata: GET_PROJECT_STATUS_METADATA,
});

toolRegistry.register({
  definition: LIST_PROJECTS_TOOL,
  handler: executeListProjects,
  metadata: LIST_PROJECTS_METADATA,
});

// Register the demonstration business tools
toolRegistry.register({
  definition: CREATE_PROJECT_TASK_TOOL,
  handler: executeCreateProjectTask,
  metadata: CREATE_PROJECT_TASK_METADATA,
});

toolRegistry.register({
  definition: UPDATE_PROJECT_TASK_TOOL,
  handler: executeUpdateProjectTask,
  metadata: UPDATE_PROJECT_TASK_METADATA,
});

toolRegistry.register({
  definition: LIST_PROJECT_TASKS_TOOL,
  handler: executeListProjectTasks,
  metadata: LIST_PROJECT_TASKS_METADATA,
});

toolRegistry.register({
  definition: SEARCH_INTEGRATION_EMAIL_TOOL,
  handler: executeSearchIntegrationEmail,
  metadata: SEARCH_INTEGRATION_EMAIL_METADATA,
});

toolRegistry.register({
  definition: READ_INTEGRATION_EMAIL_TOOL,
  handler: executeReadIntegrationEmail,
  metadata: READ_INTEGRATION_EMAIL_METADATA,
});

toolRegistry.register({
  definition: LIST_INTEGRATION_CALENDAR_EVENTS_TOOL,
  handler: executeListIntegrationCalendarEvents,
  metadata: LIST_INTEGRATION_CALENDAR_EVENTS_METADATA,
});

toolRegistry.register({
  definition: CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL,
  handler: executeCheckIntegrationCalendarAvailability,
  metadata: CHECK_INTEGRATION_CALENDAR_AVAILABILITY_METADATA,
});

toolRegistry.register({
  definition: PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL,
  handler: executePrepareIntegrationEmailDraft,
  metadata: PREPARE_INTEGRATION_EMAIL_DRAFT_METADATA,
});

toolRegistry.register({
  definition: PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL,
  handler: executePrepareIntegrationCalendarEvent,
  metadata: PREPARE_INTEGRATION_CALENDAR_EVENT_METADATA,
});

toolRegistry.register({
  definition: PROPOSE_AUTOMATION_WORKFLOW_TOOL,
  handler: executeProposeAutomationWorkflow,
  metadata: PROPOSE_AUTOMATION_WORKFLOW_METADATA,
});

toolRegistry.register({
  definition: LIST_AUTOMATION_WORKFLOWS_TOOL,
  handler: executeListAutomationWorkflows,
  metadata: LIST_AUTOMATION_WORKFLOWS_METADATA,
});

toolRegistry.register({
  definition: PREPARE_AUTOMATION_WORKFLOW_TOOL,
  handler: executePrepareAutomationWorkflow,
  metadata: PREPARE_AUTOMATION_WORKFLOW_METADATA,
});

const MODEL_FACING_TOOL_NAMES: readonly string[] = [
  CREATE_PROJECT_TOOL_NAME,
  UPDATE_PROJECT_TOOL_NAME,
  GET_PROJECT_STATUS_TOOL_NAME,
  LIST_PROJECTS_TOOL_NAME,
  CREATE_PROJECT_TASK_TOOL_NAME,
  UPDATE_PROJECT_TASK_TOOL_NAME,
  LIST_PROJECT_TASKS_TOOL_NAME,
  SEARCH_INTEGRATION_EMAIL_TOOL_NAME,
  READ_INTEGRATION_EMAIL_TOOL_NAME,
  LIST_INTEGRATION_CALENDAR_EVENTS_TOOL_NAME,
  CHECK_INTEGRATION_CALENDAR_AVAILABILITY_TOOL_NAME,
  PREPARE_INTEGRATION_EMAIL_DRAFT_TOOL_NAME,
  PREPARE_INTEGRATION_CALENDAR_EVENT_TOOL_NAME,
  PROPOSE_AUTOMATION_WORKFLOW_TOOL_NAME,
  LIST_AUTOMATION_WORKFLOWS_TOOL_NAME,
  PREPARE_AUTOMATION_WORKFLOW_TOOL_NAME,
];

export const REGISTERED_TOOLS: readonly ToolDefinition[] = Object.freeze(
  toolRegistry
    .getAll()
    .filter((tool) =>
      MODEL_FACING_TOOL_NAMES.includes(tool.definition.function.name)
    )
    .map((tool) => tool.definition)
);

/**
 * Resolves and executes a tool through the central registry.
 */
export async function executeRegisteredTool(
  toolName: string,
  rawArguments: string,
  context?: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return toolRegistry.execute(toolName, rawArguments, context);
}
