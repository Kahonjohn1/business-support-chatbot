import React, { useMemo } from "react";
import { ChatMessage } from "@/types/chat";
import { AttachmentChip } from "./AttachmentChip";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === "user";
  const attachments = message.attachments ?? [];
  const hasContent = message.content.trim().length > 0;

  const formattedTime = useMemo(() => {
    try {
      const date = new Date(message.createdAt);
      return isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [message.createdAt]);

  return (
    <div
      className={`flex flex-col my-2 sm:my-3 ${
        isUser ? "items-end" : "items-start"
      }`}
    >
      {/* Bubble Metadata */}
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">
          {isUser ? "You" : "Business Support"}
        </span>
        {formattedTime && (
          <>
            <span>•</span>
            <time dateTime={message.createdAt}>{formattedTime}</time>
          </>
        )}
      </div>

      {/* Bubble Content */}
      {hasContent && (
        <div
          className={`relative max-w-[85%] sm:max-w-[75%] md:max-w-[70%] px-4 sm:px-4.5 py-3 rounded-2xl text-sm leading-relaxed shadow-xs ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-xs"
              : "bg-surface text-foreground border border-border rounded-tl-xs"
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <ul
          className="mt-1.5 flex flex-wrap gap-2 max-w-[85%] sm:max-w-[75%] md:max-w-[70%]"
          aria-label="Attached files"
        >
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentChip attachment={attachment} />
            </li>
          ))}
        </ul>
      )}

      {/* Default-analysis note for file-only turns */}
      {isUser && !hasContent && attachments.length > 0 && (
        <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
          No message — sent for automatic analysis.
        </p>
      )}
    </div>
  );
};
