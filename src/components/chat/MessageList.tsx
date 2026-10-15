import React, { useEffect, useRef } from "react";
import { ChatMessage } from "@/types/chat";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";
import { resolveMessageListView } from "@/lib/messageListView";

interface MessageListProps {
  messages: ChatMessage[];
  onSelectPrompt?: (promptText: string) => void;
  isLoading?: boolean;
  loadingLabel?: string;
  isHydrated?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onSelectPrompt,
  isLoading = false,
  loadingLabel,
  isHydrated = true,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const view = resolveMessageListView(messages.length, isHydrated);
  const hasMessages = view === "messages";

  useEffect(() => {
    if (hasMessages && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [hasMessages, messages, isLoading]);

  return (
    <div
      role="log"
      aria-label="Conversation history"
      aria-live="polite"
      className={`flex-1 overflow-y-auto bg-background ${
        view === "empty"
          ? "flex flex-col justify-center"
          : "px-4 sm:px-6 py-4 sm:py-6 space-y-1"
      }`}
    >
      {view === "empty" && onSelectPrompt && (
        <EmptyState onSelectPrompt={onSelectPrompt} />
      )}

      {hasMessages &&
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

      {hasMessages && isLoading && <LoadingIndicator label={loadingLabel} />}

      <div ref={scrollRef} aria-hidden="true" />
    </div>
  );
};
