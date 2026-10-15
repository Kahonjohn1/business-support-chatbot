import type { ApiChatMessage, ChatMessage } from "@/types/chat";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, MAX_TOTAL_CHARS } from "@/lib/chatLimits";

/**
 * Builds the bounded context sent to the chat API. The full conversation stays
 * in the UI/store; only the most recent messages that fit the server's limits
 * are sent.
 *
 * Rules:
 * - The newest turn (the user's current message) is always included and is
 *   never truncated.
 * - Older turns are optional context: they are capped per message and the
 *   context stops once the message-count or total-character budget is reached.
 * - Messages with neither text nor usable attachments are dropped, so the
 *   request never fails validation over an empty turn.
 * - Leading assistant turns (orphans) are removed where possible so the
 *   context starts with the user.
 *
 * Attachments are only kept while their bytes are still available in the
 * session cache.
 */
export function buildRequestContext(
  messages: ChatMessage[],
  fileCache: Map<string, File>
): ApiChatMessage[] {
  const context: ApiChatMessage[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const isNewest = context.length === 0;

    // Never truncate the current user message; older context is bounded so the
    // whole request still satisfies the per-message server limit.
    const content = isNewest
      ? message.content.trim()
      : message.content.trim().slice(0, MAX_MESSAGE_CHARS);

    const attachmentIds = (message.attachments ?? [])
      .filter(
        (attachment) =>
          attachment.contentAvailable && fileCache.has(attachment.id)
      )
      .map((attachment) => attachment.id);

    if (!content && attachmentIds.length === 0) {
      continue;
    }

    // The newest turn is always kept, even if it sits exactly at a limit.
    if (!isNewest) {
      if (context.length >= MAX_MESSAGES) break;
      if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    }

    context.unshift({
      role: message.role,
      content,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
    totalChars += content.length;
  }

  // Drop orphaned leading assistant turns so the conversation starts with the
  // user. The last turn is always the user's current message, so a valid
  // context is never emptied.
  while (context.length > 1 && context[0].role === "assistant") {
    context.shift();
  }

  return context;
}
