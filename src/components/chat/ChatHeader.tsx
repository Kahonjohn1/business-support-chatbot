import React from "react";
import { NewChatIcon } from "./NewChatIcon";

interface ChatHeaderProps {
  onNewConversation: () => void;
  onOpenSidebar: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewConversation,
  onOpenSidebar,
}) => {
  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3.5 bg-surface border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex items-center justify-center p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background transition-colors lg:hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Open conversation history"
          title="Open conversation history"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
            />
          </svg>
        </button>

      </div>

      <div className="flex items-center">
        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-medium rounded-lg transition-colors border border-transparent bg-primary hover:bg-primary-hover active:bg-primary-hover text-primary-foreground shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          aria-label="Start a new chat"
          title="Start a new chat"
        >
          <NewChatIcon className="w-4 h-4 text-primary-foreground" />
        </button>
      </div>
    </header>
  );
};
