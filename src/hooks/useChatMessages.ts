"use client";

import { useCallback, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import {
  appendChatMessage,
  clearChatMessages,
  createInitialMessages,
} from "@/lib/chatMessages";

// In-memory conversation state only. Deliberately not persisted anywhere: no
// browser storage or cookie APIs are used, so a page reload always starts a
// brand-new, empty conversation with no restored history.

export interface UseChatMessagesResult {
  messages: ChatMessage[];
  appendMessage: (message: ChatMessage) => void;
  clearConversation: () => void;
}

export function useChatMessages(): UseChatMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>(createInitialMessages);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => appendChatMessage(prev, message));
  }, []);

  const clearConversation = useCallback(() => {
    setMessages(clearChatMessages());
  }, []);

  return { messages, appendMessage, clearConversation };
}
