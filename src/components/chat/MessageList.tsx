import React, { useEffect, useRef } from "react";
import { ChatMessage } from "@/types/chat";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";

interface MessageListProps {
  messages: ChatMessage[];
  onSelectPrompt?: (promptText: string) => void;
  isLoading?: boolean;
  loadingLabel?: string;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onSelectPrompt,
  isLoading = false,
  loadingLabel,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (hasMessages && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [hasMessages, messages, isLoading]);

  return (
    <div
      role="log"
      aria-label="Chat messages"
      aria-live="polite"
      className={`flex-1 overflow-y-auto bg-background ${
        hasMessages
          ? "px-4 sm:px-6 py-4 sm:py-6 space-y-1"
          : "flex flex-col justify-center"
      }`}
    >
      {!hasMessages && onSelectPrompt && (
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
