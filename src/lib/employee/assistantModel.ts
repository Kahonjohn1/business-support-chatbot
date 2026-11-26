import "server-only";

import {
  buildRequestOptions,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  resolveMaxOutputTokens,
  supportsToolCalling,
} from "@/lib/groqConfig";
import { resolveFallbackModel, runWithModelFallback } from "@/lib/groqFallback";
import type { ToolExecutionResult } from "@/lib/toolCalling";
import {
  ASSISTANT_TOOL_USE_INSTRUCTION,
  EMPLOYEE_ASSISTANT_SYSTEM_INSTRUCTION,
  EMPLOYEE_ASSISTANT_TOOLS,
  type AssistantChatMessage,
} from "./assistantTools";
import {
  parseAssistantToolCalls,
  runEmployeeToolLoop,
  type AssistantToolModelRequest,
  type AssistantToolModelResponse,
} from "./assistantToolLoop";

const API_URL = "https://api.groq.com/openai/v1/chat/completions";

export class AssistantConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantConfigError";
  }
}

export class AssistantProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AssistantProviderError";
    this.status = status;
  }
}

export class AssistantTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantTimeoutError";
  }
}

export interface AssistantAnswerResult {
  content: string;
  usedToolNames: string[];
}

interface ProviderChoice {
  message?: {
    content?: string | null;
    tool_calls?: unknown;
  };
}

interface ProviderResponse {
  choices?: ProviderChoice[];
  error?: { message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProviderResponse(value: unknown): { content: string | null; toolCalls: unknown } {
  if (!isRecord(value)) {
    throw new AssistantProviderError("The model returned an invalid response.");
  }
  const response = value as ProviderResponse;
  const message = response.choices?.[0]?.message;
  if (!message) {
    throw new AssistantProviderError("The model returned no response message.");
  }
  return {
    content: typeof message.content === "string" ? message.content : null,
    toolCalls: message.tool_calls ?? [],
  };
}

export async function generateEmployeeAssistantAnswer(
  messages: AssistantChatMessage[],
  executeTool: (toolName: string, rawArguments: string) => Promise<ToolExecutionResult>,
  signal?: AbortSignal
): Promise<AssistantAnswerResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new AssistantConfigError("The assistant service is not configured.");
  }

  const primaryModel = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  if (!supportsToolCalling(primaryModel)) {
    throw new AssistantConfigError("The configured model does not support company tools.");
  }

  const fallbackModel = resolveFallbackModel(primaryModel, process.env.GROQ_FALLBACK_MODEL);
  const maxOutputTokens = resolveMaxOutputTokens(process.env.GROQ_MAX_OUTPUT_TOKENS || MAX_OUTPUT_TOKENS);
  const requestOptions = buildRequestOptions(
    `${EMPLOYEE_ASSISTANT_SYSTEM_INSTRUCTION}\n${ASSISTANT_TOOL_USE_INSTRUCTION}`,
    signal,
    maxOutputTokens
  );
  const timeoutSignal = AbortSignal.any([
    signal ?? new AbortController().signal,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  ]);

  const attempt = async (model: string) => {
    if (!supportsToolCalling(model)) {
      throw new AssistantProviderError("The fallback model does not support company tools.", 400);
    }

    const callModel = async (
      request: AssistantToolModelRequest
    ): Promise<AssistantToolModelResponse> => {
      const body = {
        model,
        messages: [
          requestOptions.systemMessage,
          ...request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
            ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
            ...(message.name ? { name: message.name } : {}),
          })),
        ],
        tools: request.tools,
        tool_choice: request.toolChoice,
        max_completion_tokens: requestOptions.maxCompletionTokens,
      };

      let response: globalThis.Response;
      try {
        response = await fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: timeoutSignal,
        });
      } catch (error) {
        if (timeoutSignal.aborted) {
          throw new AssistantTimeoutError("The assistant request timed out.");
        }
        throw error;
      }

      const raw = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const message =
          isRecord(raw) && typeof raw.error === "object" && raw.error !== null
            ? (raw.error as { message?: unknown }).message
            : undefined;
        throw new AssistantProviderError(
          typeof message === "string" && message.trim()
            ? message
            : "The assistant service request failed.",
          response.status
        );
      }

      const parsed = parseProviderResponse(raw);
      const toolCalls = parseAssistantToolCalls(parsed.toolCalls);
      return {
        content: parsed.content,
        toolCalls,
        assistantMessage: {
          role: "assistant",
          content: parsed.content,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      };
    };

    return runEmployeeToolLoop({
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      tools: EMPLOYEE_ASSISTANT_TOOLS,
      callModel,
      executeTool,
      createToolMessage: (message) => ({
        role: "tool",
        content: message.content,
        tool_call_id: message.tool_call_id,
        name: message.name,
      }),
    });
  };

  try {
    const result = await runWithModelFallback({
      primaryModel,
      fallbackModel,
      attempt,
      signal: timeoutSignal,
    });
    return { content: result.content, usedToolNames: result.usedToolNames };
  } catch (error) {
    if (error instanceof AssistantConfigError || error instanceof AssistantTimeoutError) {
      throw error;
    }
    if (error instanceof AssistantProviderError) {
      throw error;
    }
    if (timeoutSignal.aborted) {
      throw new AssistantTimeoutError("The assistant request timed out.");
    }
    throw new AssistantProviderError("The assistant service request failed.");
  }
}
