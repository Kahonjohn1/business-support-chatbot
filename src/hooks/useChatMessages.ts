"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import {
  appendChatMessage,
  clearChatMessages,
  createInitialMessages,
  updateChatMessage,
} from "@/lib/chatMessages";
import {
  clearStoredConversation as clearStoredConversationFor,
  loadConversation as loadConversationFor,
  saveConversation as saveConversationFor,
} from "@/lib/conversationStorage";

// The conversation lives in React state and is mirrored to a session-scoped
// copy (see conversationStorage) so an accidental reload resumes where the
// user left off instead of wiping the chat. Starting a new chat discards both.

export interface UseChatMessagesOptions {
  initialMessages?: readonly ChatMessage[];
  storageKey?: string;
  userId?: string;
  useStoredSession?: boolean;
}

export interface UseChatMessagesResult {
  messages: ChatMessage[];
  appendMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearConversation: () => void;
  /** True once the initial restore has run, so callers can defer follow-ups. */
  isHydrated: boolean;
}

export function useChatMessages(
  options: UseChatMessagesOptions = {}
): UseChatMessagesResult {
  const initialMessages = options.initialMessages;
  const storageKey = options.storageKey;
  const userId = options.userId;
  const useStoredSession = options.useStoredSession !== false;
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages ? [...initialMessages] : createInitialMessages()
  );
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  // One-shot flag so the restore runs exactly once per mount (effects may run
  // twice in development) and always before the first write-through below.
  const didRestoreRef = useRef<boolean>(false);
  const previousUserIdRef = useRef<string | undefined>(userId);
  const initialMessagesRef = useRef(initialMessages);

  const loadConversation = useCallback(
    () => loadConversationFor(storageKey, userId),
    [storageKey, userId]
  );
  const saveConversation = useCallback(
    (nextMessages: readonly ChatMessage[]) =>
      saveConversationFor(nextMessages, storageKey, userId),
    [storageKey, userId]
  );
  const clearStoredConversation = useCallback(
    () => clearStoredConversationFor(storageKey, userId),
    [storageKey, userId]
  );

  useEffect(() => {
    initialMessagesRef.current = initialMessages;
  }, [initialMessages]);

  useEffect(() => {
    if (previousUserIdRef.current === userId) return;
    previousUserIdRef.current = userId;
    didRestoreRef.current = false;
    setIsHydrated(false);
    setMessages(
      initialMessagesRef.current
        ? [...initialMessagesRef.current]
        : createInitialMessages()
    );
  }, [userId]);

  // Restore after mount rather than during the first render, so the
  // server-rendered markup always matches the initial client render; reading
  // the stored copy during render would break hydration.
  useEffect(() => {
    if (didRestoreRef.current) {
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      didRestoreRef.current = true;

      if (!useStoredSession) {
        setIsHydrated(true);
        return;
      }

      const restored = loadConversation();
      setMessages((prev) => restored ?? prev);
      setIsHydrated(true);
    });

    return () => {
      active = false;
    };
  }, [loadConversation, useStoredSession]);


  // Mirror every change once the restore has run, so the transient empty
  // first render can never overwrite a stored conversation.
  useEffect(() => {
    if (!isHydrated) return;
    saveConversation(messages);
  }, [messages, isHydrated, saveConversation]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => appendChatMessage(prev, message));
  }, []);

  const updateMessage = useCallback(
    (id: string, updates: Partial<ChatMessage>) => {
      setMessages((prev) => updateChatMessage(prev, id, updates));
    },
    []
  );

  const clearConversation = useCallback(() => {
    setMessages(clearChatMessages());
    clearStoredConversation();
  }, [clearStoredConversation]);

  return { messages, appendMessage, updateMessage, clearConversation, isHydrated };
}
