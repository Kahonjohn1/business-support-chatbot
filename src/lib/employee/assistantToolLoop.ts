import {
  MAX_TOOL_CALLS,
  MAX_TOOL_ITERATIONS,
  ToolLoopError,
  parseToolCalls,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionResult,
} from "@/lib/toolCalling";

export interface AssistantToolLoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AssistantToolModelRequest {
  messages: AssistantToolLoopMessage[];
  tools: ToolDefinition[];
  toolChoice: "auto" | "none";
}

export interface AssistantToolModelResponse {
  content: string | null;
  toolCalls: ToolCall[];
  assistantMessage: AssistantToolLoopMessage;
}

export interface AssistantToolLoopOptions {
  messages: AssistantToolLoopMessage[];
  tools: readonly ToolDefinition[];
  callModel: (request: AssistantToolModelRequest) => Promise<AssistantToolModelResponse>;
  executeTool: (toolName: string, rawArguments: string) => Promise<ToolExecutionResult>;
  createToolMessage: (message: {
    role: "tool";
    tool_call_id: string;
    name: string;
    content: string;
  }) => AssistantToolLoopMessage;
  onToolResult?: (event: { iteration: number; toolName: string; ok: boolean }) => void;
}

export interface AssistantToolLoopResult {
  content: string;
  usedToolNames: string[];
}

export async function runEmployeeToolLoop(
  options: AssistantToolLoopOptions
): Promise<AssistantToolLoopResult> {
  const messages = [...options.messages];
  const usedToolNames = new Set<string>();
  let totalToolCalls = 0;

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const finalTurn = iteration === MAX_TOOL_ITERATIONS;
    const response = await options.callModel({
      messages: [...messages],
      tools: [...options.tools],
      toolChoice: finalTurn ? "none" : "auto",
    });

    if (finalTurn) {
      const content = response.content?.trim();
      if (!content) {
        throw new ToolLoopError("The model did not return a final answer after using tools.");
      }
      return { content, usedToolNames: [...usedToolNames] };
    }

    if (response.toolCalls.length === 0) {
      const content = response.content?.trim();
      if (!content) {
        throw new ToolLoopError("The model returned an empty response.");
      }
      return { content, usedToolNames: [...usedToolNames] };
    }

    messages.push(response.assistantMessage);

    for (const toolCall of response.toolCalls) {
      if (totalToolCalls >= MAX_TOOL_CALLS) {
        messages.push(
          options.createToolMessage({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: JSON.stringify({
              error: "The tool call limit was reached. No tool was executed.",
            }),
          })
        );
        continue;
      }

      totalToolCalls++;
      let result: ToolExecutionResult;
      try {
        result = await options.executeTool(toolCall.function.name, toolCall.function.arguments);
      } catch {
        result = { ok: false, error: "The tool could not be executed." };
      }

      if (result.ok) {
        usedToolNames.add(toolCall.function.name);
      }

      messages.push(
        options.createToolMessage({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: result.ok ? result.content : JSON.stringify({ error: result.error }),
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

export function parseAssistantToolCalls(value: unknown): ToolCall[] {
  return parseToolCalls(value);
}
