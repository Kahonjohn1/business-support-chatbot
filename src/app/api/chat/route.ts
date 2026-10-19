import type { MessageRole } from "@/types/chat";
import {
  MAX_ATTACHMENTS,
  MAX_BODY_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_TOTAL_CHARS,
  MAX_TOTAL_FILE_BYTES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/chatLimits";
import { parseMultipartBody, type RawFile } from "@/lib/multipart";
import { declaredBodyTooLarge, readBodyWithLimit } from "@/lib/requestBody";
import { createRateLimiter } from "@/lib/rateLimit";
import { prepareFile, type PreparedFile } from "@/lib/fileProcessing";
import {
  GeminiConfigError,
  GeminiProviderError,
  GeminiTimeoutError,
  generateAssistantReply,
  type GeminiRequestMessage,
} from "@/lib/gemini";

// Stateless chat endpoint. Conversation history lives in the client store, so
// the request carries only the context needed for this turn. Text-only turns may
// be sent as JSON; turns with files are sent as multipart/form-data.

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

// Oversized-body response: the request body may be left unconsumed, so close the
// connection after the response rather than reusing it with unread bytes.
function oversizedResponse(): Response {
  return Response.json(
    { error: "The request is too large." },
    { status: 413, headers: { Connection: "close" } }
  );
}

function readEnvInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Best-effort, process-local limiter. See src/lib/rateLimit.ts for the important
// caveat: this is not distributed protection, only a single-instance safeguard.
const rateLimiter = createRateLimiter({
  limit: readEnvInt("RATE_LIMIT_MAX", RATE_LIMIT_MAX),
  windowMs: readEnvInt("RATE_LIMIT_WINDOW_MS", RATE_LIMIT_WINDOW_MS),
});

// Client IP headers (x-forwarded-for / x-real-ip) are supplied by the caller
// unless a proxy rewrites them, so a directly exposed client can spoof them.
// Trust them only when the deployment explicitly opts in (TRUST_PROXY), e.g.
// when running behind a managed platform load balancer we control.
const TRUST_PROXY = /^(1|true|yes)$/i.test(
  process.env.TRUST_PROXY?.trim() ?? ""
);

function getClientKey(request: Request): string {
  if (TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  // No reliable per-client identity: fall back to a single shared bucket. This
  // is not spoofable, but it limits the whole instance together.
  return "global";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && !ids.includes(entry)) {
      ids.push(entry);
    }
  }
  return ids;
}

interface ParsedMessage {
  role: MessageRole;
  content: string;
  attachmentIds: string[];
}

type MessagesResult =
  | { ok: true; messages: ParsedMessage[] }
  | { ok: false; status: number; message: string };

function parseMessages(payload: unknown): MessagesResult {
  if (!isRecord(payload)) {
    return { ok: false, status: 400, message: "Invalid request body." };
  }

  const rawMessages = payload.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return { ok: false, status: 400, message: "At least one message is required." };
  }
  if (rawMessages.length > MAX_MESSAGES) {
    return { ok: false, status: 413, message: "Too many messages in this request." };
  }

  const messages: ParsedMessage[] = [];
  let totalChars = 0;

  for (const raw of rawMessages) {
    if (!isRecord(raw)) {
      return { ok: false, status: 400, message: "Invalid message format." };
    }

    const { role, content } = raw;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, status: 400, message: "Invalid message role." };
    }
    if (typeof content !== "string") {
      return { ok: false, status: 400, message: "Invalid message content." };
    }

    // Attachments are only meaningful on user turns.
    const attachmentIds =
      role === "user" ? parseAttachmentIds(raw.attachmentIds) : [];
    const trimmed = content.trim();

    if (!trimmed && attachmentIds.length === 0) {
      return { ok: false, status: 400, message: "Message content cannot be empty." };
    }
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      return { ok: false, status: 413, message: "A message is too long." };
    }

    totalChars += trimmed.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      return { ok: false, status: 413, message: "The conversation is too large." };
    }

    messages.push({ role, content: trimmed, attachmentIds });
  }

  return { ok: true, messages };
}

export async function POST(request: Request): Promise<Response> {
  const tReq0 = Date.now();
  const reqId = "api" + Math.random().toString(36).slice(2,8);
  const rate = rateLimiter.check(getClientKey(request));
  if (!rate.allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  // Reject an oversized body early when the header declares one.
  if (
    declaredBodyTooLarge(request.headers.get("content-length"), MAX_BODY_BYTES)
  ) {
    return oversizedResponse();
  }

  // Read the body ourselves, enforcing the limit even without Content-Length.
  const body = await readBodyWithLimit(request.body, MAX_BODY_BYTES);
  if (!body.ok) {
    if (body.reason === "too-large") {
      return oversizedResponse();
    }
    return errorResponse(400, "Invalid request body.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const lowerContentType = contentType.toLowerCase();

  let payload: unknown;
  let files = new Map<string, RawFile>();

  if (lowerContentType.includes("multipart/form-data")) {
    const parsed = await parseMultipartBody(body.bytes, contentType);
    if (!parsed.ok) {
      return errorResponse(parsed.status, parsed.message);
    }
    payload = parsed.payload;
    files = parsed.files;
  } else if (lowerContentType.includes("application/json")) {
    try {
      payload = JSON.parse(new TextDecoder().decode(body.bytes));
    } catch {
      return errorResponse(400, "Invalid request body.");
    }
  } else {
    return errorResponse(415, "Unsupported content type.");
  }

  const messageResult = parseMessages(payload);
  if (!messageResult.ok) {
    return errorResponse(messageResult.status, messageResult.message);
  }
  const messages = messageResult.messages;

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return errorResponse(400, "The last message must be from the user.");
  }

  // Resolve the referenced files, preserving first-seen order.
  const referencedIds: string[] = [];
  for (const message of messages) {
    for (const id of message.attachmentIds) {
      if (!referencedIds.includes(id)) referencedIds.push(id);
    }
  }

  if (referencedIds.length > MAX_ATTACHMENTS) {
    return errorResponse(413, "Too many attachments in this request.");
  }
  if (referencedIds.length > 0 && files.size === 0) {
    return errorResponse(400, "The attached files are missing from the request.");
  }

  let totalBytes = 0;
  const prepared = new Map<string, PreparedFile>();
  for (const id of referencedIds) {
    const raw = files.get(id);
    if (!raw) {
      return errorResponse(400, "An attached file is missing from the request.");
    }

    totalBytes += raw.bytes.length;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) {
      return errorResponse(413, "The attached files are too large.");
    }

    const result = prepareFile({
      id,
      name: raw.name,
      declaredMime: raw.type,
      bytes: raw.bytes,
    });
    if (!result.ok) {
      return errorResponse(result.status, result.message);
    }
    prepared.set(id, result.file);
  }

  const geminiMessages: GeminiRequestMessage[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.attachmentIds.length > 0
      ? {
          files: message.attachmentIds
            .map((id) => prepared.get(id))
            .filter((file): file is PreparedFile => file !== undefined),
        }
      : {}),
  }));

  const tPrep = Date.now();
  try {
    const totalCharsApi = messages.reduce((n,m)=>n + (m.content?.trim().length||0), 0);
    console.log(JSON.stringify({level:"info",reqId,phase:"api.prep",durMs:tPrep - tReq0,ctx:{msgCount:messages.length,totalChars:totalCharsApi,attachCount:referencedIds.length,totalAttachBytes:totalBytes}}));
  } catch {}
  try {
    const reply = await generateAssistantReply(geminiMessages, request.signal);
    try { console.log(JSON.stringify({level:"info",reqId,phase:"api.total.ok",totalMs:Date.now()-tReq0})); } catch {}
    return Response.json({ message: { role: "assistant", content: reply } });
  } catch (error) {
    try { console.log(JSON.stringify({level:"error",reqId,phase:"api.total.fail",totalMs:Date.now()-tReq0})); } catch {}
    if (error instanceof GeminiConfigError) {
      console.error("[api/chat] configuration error:", error.message);
      return errorResponse(500, "The chat service is not configured.");
    }
    if (error instanceof GeminiTimeoutError) {
      console.error("[api/chat] timeout:", error.message);
      return errorResponse(
        504,
        "The assistant took too long to respond. Please try again."
      );
    }
    if (error instanceof GeminiProviderError) {
      console.error("[api/chat] provider error:", error.message);
      return errorResponse(
        502,
        "The assistant is unavailable right now. Please try again."
      );
    }
    console.error(
      "[api/chat] unexpected error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return errorResponse(500, "Something went wrong. Please try again.");
  }
}