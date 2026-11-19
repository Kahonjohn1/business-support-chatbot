// Provider-neutral, bounded tool-call orchestration.
//
// Kept free of provider and server-only imports so the loop, its limits, and
// response parsing can be unit tested without calling Groq.

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string;
}

export interface ToolExecutionMeta {
  requestId: string;
  toolCallId?: string;
  durationMs: number;
  timestamp: number;
}

export interface ToolExecutionSuccess<T = unknown> {
  ok: true;
  content: string;
  data?: T;
  meta?: ToolExecutionMeta;
}

export interface ToolExecutionFailure {
  ok: false;
  error: string;
  code?: string;
  meta?: ToolExecutionMeta;
}

export type ToolExecutionResult<T = unknown> =
  | ToolExecutionSuccess<T>
  | ToolExecutionFailure;

export interface ToolModelRequest<TMessage> {
  messages: TMessage[];
  tools: ToolDefinition[];
  toolChoice: "auto" | "none";
}

export interface ToolModelResponse<TMessage> {
  content: string | null;
  toolCalls: ToolCall[];
  /** The provider's assistant message, including tool_calls, to append. */
  assistantMessage: TMessage;
}

export interface ToolLoopEvent {
  iteration: number;
  toolName: string;
  ok: boolean;
}

export interface ToolExecutionContext {
  readonly requestId: string;
  readonly toolCallId?: string;
  readonly timestamp?: number;
  readonly auth?: unknown;
  /**
   * Server-only approval capability. Never populated from model-supplied tool
   * arguments; only the approval endpoint may set it after a verified decision.
   */
  readonly approvalId?: string;
}

export interface ToolLoopOptions<TMessage extends { role: string }> {
  messages: TMessage[];
  tools: ToolDefinition[];
  callModel: (
    request: ToolModelRequest<TMessage>
  ) => Promise<ToolModelResponse<TMessage>>;
  executeTool: (
    toolName: string,
    rawArguments: string,
    context?: ToolExecutionContext
  ) => ToolExecutionResult;
  createToolMessage: (message: ToolMessage) => TMessage;
  maxIterations?: number;
  maxToolCalls?: number;
  onToolResult?: (event: ToolLoopEvent) => void;
  requestId?: string;
  auth?: unknown;
}

export interface ToolLoopResult {
  content: string;
  usedToolNames: string[];
  pendingApproval?: {
    approvalId: string;
    toolName: string;
    summary: string;
    details: Record<string, unknown>;
  };
}

/** Maximum number of tool-execution rounds before a final answer is forced. */
export const MAX_TOOL_ITERATIONS = 2;

/** Maximum number of registered tool executions across the whole turn. */
export const MAX_TOOL_CALLS = 4;

export class ToolLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolLoopError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates the provider's tool_calls array. Malformed responses are rejected
 * rather than partially trusted, and a single response cannot exceed the
 * per-turn tool-call cap.
 */
export function parseToolCalls(value: unknown): ToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ToolLoopError("Malformed tool call response.");
  }
  if (value.length > MAX_TOOL_CALLS) {
    throw new ToolLoopError("The model returned too many tool calls.");
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new ToolLoopError("Malformed tool call response.");
    }
    const callFunction = entry.function;
    if (
      (entry.type !== undefined && entry.type !== "function") ||
      typeof entry.id !== "string" ||
      !entry.id.trim() ||
      !isRecord(callFunction) ||
      typeof callFunction.name !== "string" ||
      !callFunction.name.trim() ||
      typeof callFunction.arguments !== "string"
    ) {
      throw new ToolLoopError("Malformed tool call response.");
    }

    return {
      id: entry.id,
      type: "function",
      function: {
        name: callFunction.name,
        arguments: callFunction.arguments,
      },
    };
  });
}

/**
 * Runs a bounded tool loop. Only the injected executeTool function can run, and
 * every returned call is answered so the provider conversation stays valid.
 *
 * After maxIterations tool rounds, a final request with tool_choice "none" is
 * made to obtain a text answer. Execution is capped separately by maxToolCalls.
 */
export async function runToolLoop<TMessage extends { role: string }>(
  options: ToolLoopOptions<TMessage>
): Promise<ToolLoopResult> {
  const maxIterations = options.maxIterations ?? MAX_TOOL_ITERATIONS;
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS;
  const messages = [...options.messages];
  const usedToolNames = new Set<string>();
  let pendingApproval: ToolLoopResult["pendingApproval"] = undefined;
  let totalToolCalls = 0;

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    const finalTurn = iteration === maxIterations;
    const response = await options.callModel({
      messages: [...messages],
      tools: options.tools,
      toolChoice: finalTurn ? "none" : "auto",
    });

    if (finalTurn) {
      const content = response.content?.trim();
      if (content) {
        return {
          content,
          usedToolNames: [...usedToolNames],
          ...(pendingApproval ? { pendingApproval } : {}),
        };
      }
      throw new ToolLoopError(
        "The model did not return a final answer after using tools."
      );
    }

    if (response.toolCalls.length === 0) {
      const content = response.content?.trim();
      if (content) {
        return {
          content,
          usedToolNames: [...usedToolNames],
          ...(pendingApproval ? { pendingApproval } : {}),
        };
      }
      throw new ToolLoopError("The model returned an empty response.");
    }

    messages.push(response.assistantMessage);

    for (const toolCall of response.toolCalls) {
      if (totalToolCalls >= maxToolCalls) {
        messages.push(
          options.createToolMessage({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify({
              error:
                "The tool call limit was reached. No tool was executed.",
            }),
          })
        );
        continue;
      }

      totalToolCalls++;
      let result: ToolExecutionResult;
      try {
        result = options.executeTool(
          toolCall.function.name,
          toolCall.function.arguments,
          {
            requestId: options.requestId ?? "unknown-req",
            toolCallId: toolCall.id,
            timestamp: Date.now(),
            ...(options.auth !== undefined ? { auth: options.auth } : {}),
          }
        );
      } catch {
        result = {
          ok: false,
          error: "The tool could not be executed.",
          code: "EXECUTION_FAILED",
        };
      }

      if (result.ok) {
        usedToolNames.add(toolCall.function.name);
        const data = (result as { data?: unknown }).data;
        if (
          isRecord(data) &&
          data.status === "pending_approval" &&
          typeof data.approvalId === "string"
        ) {
          pendingApproval = {
            approvalId: data.approvalId,
            toolName: toolCall.function.name,
            summary:
              typeof data.summary === "string"
                ? data.summary
                : `Approval required for ${toolCall.function.name}`,
            details: isRecord(data.details) ? data.details : {},
          };
        }
      }
      messages.push(
        options.createToolMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result.ok
            ? result.content
            : JSON.stringify({
                error: result.error,
                ...("code" in result && typeof result.code === "string"
                  ? { code: result.code }
                  : {}),
              }),
        })
      );
      options.onToolResult?.({
        iteration,
        toolName: toolCall.function.name,
        ok: result.ok,
      });
    }
  }

  throw new ToolLoopError("The tool loop ended without a final answer.");
}
