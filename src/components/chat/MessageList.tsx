import React, { useEffect, useRef } from "react";
import { ChatMessage } from "@/types/chat";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";
import { LoadingIndicator } from "./LoadingIndicator";

interface MessageListProps {
  messages: ChatMessage[];
  onSelectPrompt?: (promptText: string) => void;
  isLoading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onSelectPrompt,
  isLoading = false,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col justify-center bg-background">
        {onSelectPrompt && <EmptyState onSelectPrompt={onSelectPrompt} />}
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Conversation history"
      aria-live="polite"
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 bg-background space-y-1"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {isLoading && <LoadingIndicator />}

      <div ref={scrollRef} aria-hidden="true" />
    </div>
  );
};
