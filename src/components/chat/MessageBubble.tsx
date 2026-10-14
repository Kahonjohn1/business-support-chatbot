import React, { useMemo } from "react";
import { ChatMessage } from "@/types/chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === "user";

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
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-[#66736A]">
        <span className="font-medium text-[#17251D]">
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
      <div
        className={`relative max-w-[85%] sm:max-w-[75%] md:max-w-[70%] px-4 sm:px-4.5 py-3 rounded-2xl text-sm leading-relaxed shadow-xs ${
          isUser
            ? "bg-[#128C4A] text-[#FFFFFF] rounded-tr-xs"
            : "bg-[#FFFFFF] text-[#17251D] border border-[#E0E7E1] rounded-tl-xs"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
};
