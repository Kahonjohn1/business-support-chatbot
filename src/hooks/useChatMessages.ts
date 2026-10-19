"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import {
  appendChatMessage,
  clearChatMessages,
  createInitialMessages,
} from "@/lib/chatMessages";
import {
  clearStoredConversation,
  loadConversation,
  saveConversation,
} from "@/lib/conversationStorage";

// The conversation lives in React state and is mirrored to a session-scoped
// copy (see conversationStorage) so an accidental reload resumes where the
// user left off instead of wiping the chat. Starting a new chat discards both.

export interface UseChatMessagesResult {
  messages: ChatMessage[];
  appendMessage: (message: ChatMessage) => void;
  clearConversation: () => void;
  /** True once the initial restore has run, so callers can defer follow-ups. */
  isHydrated: boolean;
}

export function useChatMessages(): UseChatMessagesResult {
  const [messages, setMessages] = useState<ChatMessage[]>(createInitialMessages);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // One-shot flag so the restore runs exactly once per mount (effects may run
  // twice in development) and always before the first write-through below.
  const didRestoreRef = useRef<boolean>(false);

  // Restore after mount rather than during the first render, so the
  // server-rendered markup always matches the initial client render; reading
  // the stored copy during render would break hydration.
  useEffect(() => {
    if (didRestoreRef.current) {
      return;
    }
    didRestoreRef.current = true;

    const restored = loadConversation();
    setMessages((prev) => restored ?? prev);
    setIsHydrated(true);
  }, []);

  // Mirror every change once the restore has run, so the transient empty
  // first render can never overwrite a stored conversation.
  useEffect(() => {
    if (!isHydrated) return;
    saveConversation(messages);
  }, [messages, isHydrated]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => appendChatMessage(prev, message));
  }, []);

  const clearConversation = useCallback(() => {
    setMessages(clearChatMessages());
    clearStoredConversation();
  }, []);

  return { messages, appendMessage, clearConversation, isHydrated };
}
