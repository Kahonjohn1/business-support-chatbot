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

export type ToolExecutionResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

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

export interface ToolLoopOptions<TMessage extends { role: string }> {
  messages: TMessage[];
  tools: ToolDefinition[];
  callModel: (
    request: ToolModelRequest<TMessage>
  ) => Promise<ToolModelResponse<TMessage>>;
  executeTool: (toolName: string, rawArguments: string) => ToolExecutionResult;
  createToolMessage: (message: ToolMessage) => TMessage;
  maxIterations?: number;
  maxToolCalls?: number;
  onToolResult?: (event: ToolLoopEvent) => void;
}

export interface ToolLoopResult {
  content: string;
  usedToolNames: string[];
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
        return { content, usedToolNames: [...usedToolNames] };
      }
      throw new ToolLoopError(
        "The model did not return a final answer after using tools."
      );
    }

    if (response.toolCalls.length === 0) {
      const content = response.content?.trim();
      if (content) {
        return { content, usedToolNames: [...usedToolNames] };
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
          toolCall.function.arguments
        );
      } catch {
        result = {
          ok: false,
          error: "The tool could not be executed.",
        };
      }

      if (result.ok) {
        usedToolNames.add(toolCall.function.name);
      }
      messages.push(
        options.createToolMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result.ok
            ? result.content
            : JSON.stringify({ error: result.error }),
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
