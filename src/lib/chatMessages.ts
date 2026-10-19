import type { ChatMessage } from "@/types/chat";

// Pure helpers for the active conversation. Kept free of React and free of any
// persistence APIs so the rules can be tested directly; reload recovery lives
// in conversationStorage and is wired up by useChatMessages.

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
