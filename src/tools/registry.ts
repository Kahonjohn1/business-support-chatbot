import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionMeta,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  ToolExecutionResult,
} from "@/lib/toolCalling";
import {
  GET_PROJECT_STATUS_TOOL,
  GET_PROJECT_STATUS_METADATA,
  LIST_PROJECTS_TOOL,
  LIST_PROJECTS_METADATA,
  executeGetProjectStatus,
  executeListProjects,
} from "@/tools/projectStatusTool";
import {
  CREATE_PROJECT_TASK_TOOL,
  CREATE_PROJECT_TASK_METADATA,
  executeCreateProjectTask,
  LIST_PROJECT_TASKS_TOOL,
  LIST_PROJECT_TASKS_METADATA,
  executeListProjectTasks,
} from "@/tools/tasksTool";
import {
  checkPermission,
  hasPermissionPolicy,
  type AuthorizationContext,
} from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/auditLog";

export type {
  ToolExecutionContext,
  ToolExecutionMeta,
  ToolExecutionSuccess,
  ToolExecutionFailure,
  ToolExecutionResult,
};

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
) => StructuredToolOutput;

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
  execute(
    name: string,
    rawArguments: string,
    context?: ToolExecutionContext
  ): ToolExecutionResult {
    const t0 = Date.now();
    const ctx = context ?? createDefaultExecutionContext();
    const tool = this.tools.get(name);

    if (!tool) {
      const durationMs = Date.now() - t0;
      recordAuditEvent({
        requestId: ctx.requestId,
        toolName: name,
        operation: "tool_dispatch",
        status: "denied",
        executionOutcome: {
          ok: false,
          code: "UNKNOWN_TOOL",
          durationMs,
        },
      });

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
        recordAuditEvent({
          requestId: ctx.requestId,
          toolName: name,
          operation: "permission_check",
          status: "denied",
          permissionDecision: {
            permitted: false,
            reason: "Verified user identity is required.",
          },
        });

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
        recordAuditEvent({
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
        });

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

      recordAuditEvent({
        requestId: ctx.requestId,
        toolName: name,
        operation: "permission_check",
        status: "permitted",
        permissionDecision: {
          permitted: true,
          role: authContext?.role,
          requiredPermission: permResult.requiredPermission,
        },
      });
    }

    let rawHandlerResult: unknown;
    try {
      rawHandlerResult = tool.handler(rawArguments, ctx);
    } catch (error) {
      const durationMs = Date.now() - t0;
      const errorMessage =
        error instanceof Error
          ? error.message
          : "The tool could not be executed.";

      recordAuditEvent({
        requestId: ctx.requestId,
        toolName: name,
        operation: "tool_execution",
        status: "failed",
        executionOutcome: {
          ok: false,
          code: "EXECUTION_FAILED",
          durationMs,
        },
      });

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
      recordAuditEvent({
        requestId: ctx.requestId,
        toolName: name,
        operation: "tool_execution",
        status: "failed",
        executionOutcome: {
          ok: false,
          code: "INVALID_RESULT",
          durationMs,
        },
      });

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
    recordAuditEvent({
      requestId: ctx.requestId,
      toolName: name,
      operation: "tool_execution",
      status: validated.ok ? "executed" : "failed",
      executionOutcome: {
        ok: validated.ok,
        code: validated.ok ? undefined : validated.error.code,
        durationMs,
      },
    });

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

// Register the read-only project tools.
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
  definition: LIST_PROJECT_TASKS_TOOL,
  handler: executeListProjectTasks,
  metadata: LIST_PROJECT_TASKS_METADATA,
});

const MODEL_FACING_TOOL_NAMES: readonly string[] = [];

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
export function executeRegisteredTool(
  toolName: string,
  rawArguments: string,
  context?: ToolExecutionContext
): ToolExecutionResult {
  return toolRegistry.execute(toolName, rawArguments, context);
}
