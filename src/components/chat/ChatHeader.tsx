import React, { useEffect, useRef } from "react";
import { NewChatIcon } from "./NewChatIcon";
import { HumanSupport } from "./HumanSupport";

const SUPPORT_PANEL_ID = "contact-support-popover";

interface ChatHeaderProps {
  onNewConversation: () => void;
  onContactSupport?: () => void;
  onCloseSupport?: () => void;
  isSupportOpen?: boolean;
  supportSummary?: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewConversation,
  onContactSupport,
  onCloseSupport,
  isSupportOpen = false,
  supportSummary = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Dismiss the dropdown when the user clicks outside it or presses Escape.
  useEffect(() => {
    if (!isSupportOpen || !onCloseSupport) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        onCloseSupport();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseSupport();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSupportOpen, onCloseSupport]);

  const closeSupport = onCloseSupport ?? onContactSupport;

  return (
    <header className="relative flex items-center justify-between gap-2 sm:gap-3 px-4 sm:px-6 py-3.5 bg-surface border-b border-border shrink-0">
      {onContactSupport && (
        <div ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={onContactSupport}
            aria-expanded={isSupportOpen}
            aria-controls={SUPPORT_PANEL_ID}
            className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-medium rounded-lg transition-colors border border-primary/40 bg-surface hover:bg-accent active:bg-muted text-accent-foreground shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
            aria-label={
              isSupportOpen ? "Hide contact support" : "Contact support"
            }
            title="Contact support"
          >
            <svg
              className="w-4 h-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.9}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
              />
            </svg>
            <span className="hidden sm:inline">Contact Support</span>
            <svg
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                isSupportOpen ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 8.25l-7.5 7.5-7.5-7.5"
              />
            </svg>
          </button>

          {isSupportOpen && closeSupport && (
            <HumanSupport
              id={SUPPORT_PANEL_ID}
              summary={supportSummary}
              onClose={closeSupport}
            />
          )}
        </div>
      )}

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
