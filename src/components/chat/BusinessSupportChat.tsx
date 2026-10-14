"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ErrorBanner } from "./ErrorBanner";

// This is a frontend-only demonstration. No API, AI model, or backend is involved.
// The loading period is a local timer and the resulting message is intentionally an error.
const DEMO_LOADING_MS = 1200;
const DEMO_ERROR_MESSAGE =
  "Demo error: this interaction is being demonstrated locally.";

export const BusinessSupportChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    // 5. Append the message to the existing message array without removing previous messages.
    setMessages((prev) => [...prev, userMessage]);

    // 6. Clear the composer after the user message is successfully added to local state.
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
    // Invalidate any past asynchronous demonstration tasks
    conversationSessionRef.current += 1;
    clearDemoTimer();

    // Reset local conversation state safely to original empty state
    setMessages([]);
    setInput("");
    setError(null);
    setIsLoading(false);
  };

  return (
    <section
      aria-label="Business Support Chatbot"
      className="flex flex-col w-full max-w-3xl h-[680px] sm:h-[740px] md:h-[800px] max-h-[90vh] bg-[#FFFFFF] border border-[#E0E7E1] rounded-2xl overflow-hidden shadow-xs"
    >
      <ChatHeader onNewConversation={handleNewConversation} />

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
    </section>
  );
};
