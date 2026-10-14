"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ErrorBanner } from "./ErrorBanner";
import { ConversationSidebar } from "./ConversationSidebar";
import { useConversations } from "@/hooks/useConversations";
import { createMessageId, deriveConversationTitle } from "@/lib/conversations";

// This is a frontend-only demonstration. No API, AI model, or backend is involved.
// The loading period is a local timer and the resulting message is intentionally an error.
const DEMO_LOADING_MS = 1200;
const DEMO_ERROR_MESSAGE =
  "Demo error: this interaction is being demonstrated locally.";

export const BusinessSupportChat: React.FC = () => {
  const {
    conversations,
    appendMessage,
    renameConversation,
    removeConversation,
  } = useConversations();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Guard to ensure any asynchronous demonstration cannot update a reset conversation
  const conversationSessionRef = useRef<number>(0);

  // Handle for the pending demonstration timer so it can be cleared safely
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDemoTimer = useCallback(() => {
    if (demoTimerRef.current !== null) {
      clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  // Clean up any pending timer if the component unmounts
  useEffect(() => {
    return () => {
      clearDemoTimer();
    };
  }, [clearDemoTimer]);

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? null,
    [conversations, activeConversationId]
  );

  const messages = activeConversation?.messages ?? [];

  // Runs the local loading demonstration and resolves to the demonstration error.
  const runDemo = useCallback(() => {
    const session = conversationSessionRef.current;

    clearDemoTimer();
    setError(null);
    setIsLoading(true);

    demoTimerRef.current = setTimeout(() => {
      demoTimerRef.current = null;

      // If the conversation was reset (or the component moved on), ignore this result
      if (conversationSessionRef.current !== session) {
        return;
      }

      setIsLoading(false);
      setError(DEMO_ERROR_MESSAGE);
    }, DEMO_LOADING_MS);
  }, [clearDemoTimer]);

  // Invalidate any asynchronous demonstration and clear its transient UI state.
  const resetTransientState = useCallback(() => {
    conversationSessionRef.current += 1;
    clearDemoTimer();
    setIsLoading(false);
    setError(null);
  }, [clearDemoTimer]);

  const handleSendMessage = () => {
    // 1. Trim whitespace from the input.
    const trimmed = input.trim();

    // 2. If the message is empty, do nothing.
    if (!trimmed) {
      return;
    }

    // 3. If a submission is already in progress, prevent another submission.
    if (isLoading) {
      return;
    }

    // 4. Create a user message containing a unique ID, role "user", trimmed content, and ISO timestamp.
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    // 5. Append to the active conversation, or start a new one titled from the message.
    const conversationId = appendMessage(
      activeConversationId,
      userMessage,
      deriveConversationTitle(trimmed)
    );
    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
    }

    // 6. Clear the composer after the user message is added to local state.
    setInput("");

    // 7. Clear any previous error and start the local loading demonstration.
    runDemo();
  };

  const handleRetryDemo = () => {
    // Do not allow overlapping retries while a demonstration is in progress.
    if (isLoading) {
      return;
    }

    // Re-run the same local demonstration; no message is sent and no reply is created.
    runDemo();
  };

  const handleSelectPrompt = (promptText: string) => {
    // Places suggestion text into the message composer without auto-submitting
    setInput(promptText);
    setError(null);
  };

  const handleNewConversation = () => {
    // Existing conversations are preserved; only the active view is cleared.
    resetTransientState();
    setActiveConversationId(null);
    setInput("");
  };

  const handleSelectConversation = (id: string) => {
    // Switching conversations cancels any pending demonstration to avoid carrying state over.
    resetTransientState();
    setActiveConversationId(id);
    setInput("");
  };

  const handleRenameConversation = (id: string, title: string) => {
    renameConversation(id, title);
  };

  const handleDeleteConversation = (id: string) => {
    removeConversation(id);

    if (activeConversationId === id) {
      resetTransientState();
      setActiveConversationId(null);
      setInput("");
    }
  };

  return (
    <section
      aria-label="Business Support Chatbot"
      className="relative flex w-full max-w-6xl h-[680px] sm:h-[740px] md:h-[800px] max-h-[90vh] bg-[#FFFFFF] border border-[#E0E7E1] rounded-2xl overflow-hidden shadow-xs"
    >
      {isSidebarOpen && (
        <div
          className="absolute inset-0 z-30 bg-[#17251D]/30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      <div className="flex flex-col flex-1 min-w-0 bg-[#FFFFFF]">
        <ChatHeader
          onNewConversation={handleNewConversation}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />

        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          onRetry={handleRetryDemo}
        />

        <main className="flex-1 flex flex-col min-h-0 relative bg-[#F8F7F2]">
          <MessageList
            messages={messages}
            onSelectPrompt={handleSelectPrompt}
            isLoading={isLoading}
          />
        </main>

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSendMessage}
          disabled={isLoading}
        />
      </div>
    </section>
  );
};
