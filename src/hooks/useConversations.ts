"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage, Conversation } from "@/types/chat";
import {
  createConversationId,
  loadConversations,
  saveConversations,
} from "@/lib/conversations";

// A tiny module-level store keeps conversations shared and lets persistence
// live outside React, so hydration never overwrites saved data with an empty list.
let conversations: Conversation[] = [];
let initialized = false;
const listeners = new Set<() => void>();
const EMPTY_CONVERSATIONS: Conversation[] = [];

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;
  conversations = loadConversations();
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Conversation[] {
  ensureInitialized();
  return conversations;
}

function getServerSnapshot(): Conversation[] {
  return EMPTY_CONVERSATIONS;
}

function commit(next: Conversation[]): void {
  conversations = next;
  saveConversations(next);
  emit();
}

function appendMessage(
  conversationId: string | null,
  message: ChatMessage,
  newConversationTitle: string
): string {
  ensureInitialized();

  const existing = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId)
    : undefined;

  if (existing) {
    commit(
      conversations.map((conversation) =>
        conversation.id === existing.id
          ? {
              ...conversation,
              messages: [...conversation.messages, message],
              updatedAt: message.createdAt,
            }
          : conversation
      )
    );
    return existing.id;
  }

  const created: Conversation = {
    id: createConversationId(),
    title: newConversationTitle,
    messages: [message],
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
  };
  commit([created, ...conversations]);
  return created.id;
}

function renameConversation(id: string, title: string): void {
  ensureInitialized();
  commit(
    conversations.map((conversation) =>
      conversation.id === id ? { ...conversation, title } : conversation
    )
  );
}

function removeConversation(id: string): void {
  ensureInitialized();
  commit(conversations.filter((conversation) => conversation.id !== id));
}

export interface UseConversationsResult {
  conversations: Conversation[];
  appendMessage: (
    conversationId: string | null,
    message: ChatMessage,
    newConversationTitle: string
  ) => string;
  renameConversation: (id: string, title: string) => void;
  removeConversation: (id: string) => void;
}

export function useConversations(): UseConversationsResult {
  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return {
    conversations: state,
    appendMessage,
    renameConversation,
    removeConversation,
  };
}
