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

        {/* Simple original chat icon */}
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent border border-border text-primary shrink-0"
          aria-hidden="true"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 8.25h9m-9 3H12m-9.75 6.75l2.4-1.6a2.25 2.25 0 011.25-.38h11.1a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 5.25v10.5c0 .34.076.663.212.953z"
            />
          </svg>
        </div>
      </div>

      <div className="flex items-center">
        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-medium rounded-lg transition-colors border bg-surface hover:bg-accent active:bg-muted text-foreground border-border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          aria-label="Start a new chat"
          title="Start a new chat"
        >
          <NewChatIcon className="w-4 h-4 text-primary" />
          <span className="hidden sm:inline">New chat</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>
    </header>
  );
};
