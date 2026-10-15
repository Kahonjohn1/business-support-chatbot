import type { Attachment, MessageRole } from "@/types/chat";
import { MAX_MESSAGE_CHARS } from "@/lib/chatLimits";
import { totalAttachmentSizeError } from "@/lib/attachments";

// Pure decision logic for the composer. Kept free of React so the guard rules
// can be unit-tested directly and reused by the send/retry handlers.

interface RoleBearing {
  role: MessageRole;
}

/**
 * True when the conversation ends on a user turn that never received an
 * assistant reply (e.g. the previous request failed). Appending another user
 * message in that state would produce two consecutive user turns, which the
 * provider rejects.
 */
export function hasUnansweredUserTurn(messages: readonly RoleBearing[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "user";
}

export type SubmissionRejectionReason =
  | "message-too-long"
  | "attachments-too-large"
  | "awaiting-reply";

export interface SubmissionRejection {
  ok: false;
  reason: SubmissionRejectionReason;
  message: string;
}

export type SubmissionDecision = { ok: true } | SubmissionRejection;

export interface SubmissionInput {
  messages: readonly RoleBearing[];
  text: string;
  attachments: readonly Attachment[];
}

/**
 * Decides whether the current composer contents may be submitted. Callers must
 * already have ruled out an empty submission (no text and no attachments) and
 * must honour the returned rejection without clearing the user's input.
 */
export function evaluateSubmission(input: SubmissionInput): SubmissionDecision {
  const trimmed = input.text.trim();

  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      reason: "message-too-long",
      message: `Messages are limited to ${MAX_MESSAGE_CHARS} characters. Please shorten your message and try again.`,
    };
  }

  const sizeError = totalAttachmentSizeError(input.attachments);
  if (sizeError) {
    return { ok: false, reason: "attachments-too-large", message: sizeError };
  }

  if (hasUnansweredUserTurn(input.messages)) {
    return {
      ok: false,
      reason: "awaiting-reply",
      message:
        "Your previous message hasn't been answered yet. Retry it or start a new chat before sending another message.",
    };
  }

  return { ok: true };
}

/**
 * True when an in-flight reply must be discarded because its request was
 * aborted (new conversation, switch, unmount) or the conversation changed since
 * the request started.
 */
export function isStaleResponse(params: {
  aborted: boolean;
  startSession: number;
  currentSession: number;
}): boolean {
  return params.aborted || params.startSession !== params.currentSession;
}
