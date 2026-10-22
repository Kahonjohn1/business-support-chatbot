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
  // Only well-formed source metadata is rendered; anything else is ignored.
  const sources = useMemo(
    () => (message.sources ?? []).filter((source) => source.id && source.title),
    [message.sources]
  );

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

      {/* Documents consulted for this answer */}
      {!isUser && sources.length > 0 && (
        <div className="mt-1.5 max-w-[85%] sm:max-w-[75%] md:max-w-[70%]">
          <p className="text-[11px] font-medium text-muted-foreground">
            Sources consulted
          </p>
          <ul
            className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground"
            aria-label="Sources consulted"
          >
            {sources.map((source) => (
              <li key={source.id}>
                <span className="font-medium text-foreground">
                  {source.title}
                </span>
                {source.section && (
                  <span> — {source.section}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The approved documents do not cover the requested detail */}
      {!isUser && message.insufficientEvidence && (
        <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
          The approved knowledge base does not specify this detail.
        </p>
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
