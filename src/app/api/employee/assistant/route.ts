import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  MAX_TOTAL_CHARS,
} from "@/lib/chatLimits";
import { isSameOriginRequest } from "@/lib/http/origin";
import { declaredBodyTooLarge, readBodyWithLimit } from "@/lib/requestBody";
import { ToolLoopError } from "@/lib/toolCalling";
import { getEmployeeSession } from "@/lib/employee/session";
import {
  AssistantConfigError,
  AssistantProviderError,
  AssistantTimeoutError,
  generateEmployeeAssistantAnswer,
} from "@/lib/employee/assistantModel";
import {
  executeEmployeeAssistantTool,
  getAssistantToolContext,
} from "@/lib/employee/assistantToolRuntime";
import type { AssistantChatMessage } from "@/lib/employee/assistantTools";

const MAX_ASSISTANT_BODY_BYTES = 64 * 1024;

interface MessageParseResult {
  ok: true;
  messages: AssistantChatMessage[];
}

function errorResponse(status: number, message: string): Response {
  return NextResponse.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessages(value: unknown): MessageParseResult | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  if (value.messages.length === 0 || value.messages.length > MAX_MESSAGES) return null;

  const messages: AssistantChatMessage[] = [];
  let totalChars = 0;

  for (const entry of value.messages) {
    if (!isRecord(entry)) return null;
    if (Object.keys(entry).some((key) => key !== "role" && key !== "content")) return null;
    if (entry.role !== "user" && entry.role !== "assistant") return null;
    if (typeof entry.content !== "string") return null;

    const content = entry.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;

    messages.push({ role: entry.role, content });
  }

  if (messages[messages.length - 1]?.role !== "user") return null;
  return { ok: true, messages };
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return errorResponse(403, "Invalid request origin");
  }

  const session = await getEmployeeSession();
  if (!session) {
    return errorResponse(401, "Employee authentication is required.");
  }

  const context = await getAssistantToolContext(session);
  if (!context) {
    return errorResponse(403, "Active company membership is required.");
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return errorResponse(415, "JSON is required.");
  }
  if (declaredBodyTooLarge(request.headers.get("content-length"), MAX_ASSISTANT_BODY_BYTES)) {
    return errorResponse(413, "The request is too large.");
  }

  const body = await readBodyWithLimit(request.body, MAX_ASSISTANT_BODY_BYTES);
  if (!body.ok) {
    return errorResponse(body.reason === "too-large" ? 413 : 400, "The request could not be read.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return errorResponse(400, "Invalid JSON request body.");
  }

  const parsed = parseMessages(payload);
  if (!parsed) {
    return errorResponse(400, "Invalid assistant conversation.");
  }

  try {
    const answer = await generateEmployeeAssistantAnswer(
      parsed.messages,
      (toolName, rawArguments) =>
        executeEmployeeAssistantTool(context, toolName, rawArguments),
      request.signal
    );

    return NextResponse.json({
      message: answer.content,
      usedTools: answer.usedToolNames,
    });
  } catch (error) {
    if (error instanceof AssistantConfigError) {
      return errorResponse(500, error.message);
    }
    if (error instanceof AssistantTimeoutError) {
      return errorResponse(504, "The assistant request timed out.");
    }
    if (error instanceof AssistantProviderError) {
      return errorResponse(502, "The assistant service request failed.");
    }
    if (error instanceof ToolLoopError) {
      return errorResponse(502, "The assistant could not complete a grounded answer.");
    }
    return errorResponse(500, "The assistant request failed.");
  }
}
