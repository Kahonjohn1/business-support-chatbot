import React from "react";
import { NewChatIcon } from "./NewChatIcon";

interface ChatHeaderProps {
  onNewConversation: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewConversation,
}) => {
  return (
    <header className="flex items-center justify-end gap-3 px-4 sm:px-6 py-3.5 bg-surface border-b border-border shrink-0">
      <button
        type="button"
        onClick={onNewConversation}
        className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-medium rounded-lg transition-colors border border-transparent bg-[var(--action-teal)] hover:brightness-95 active:brightness-90 text-primary-foreground shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--action-teal)] focus:ring-offset-1"
        aria-label="Start a new chat"
        title="Start a new chat"
      >
        <NewChatIcon className="w-4 h-4 text-primary-foreground" />
        <span className="hidden sm:inline">New chat</span>
      </button>
    </header>
  );
};
