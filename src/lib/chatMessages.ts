import type { ChatMessage } from "@/types/chat";

// Pure helpers for the single, in-memory conversation. There is intentionally
// no storage here: the conversation is never persisted, so a page reload always
// starts from an empty state. Kept free of React so the rules can be tested.

export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** A fresh conversation always starts empty. */
export function createInitialMessages(): ChatMessage[] {
  return [];
}

/** Returns a new array with the message appended (input is not mutated). */
export function appendChatMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage
): ChatMessage[] {
  return [...messages, message];
}

/** A cleared conversation is empty; nothing is retained. */
export function clearChatMessages(): ChatMessage[] {
  return [];
}
