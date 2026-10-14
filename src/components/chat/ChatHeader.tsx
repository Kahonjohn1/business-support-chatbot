import React from "react";

interface ChatHeaderProps {
  onNewConversation: () => void;
  onOpenSidebar: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewConversation,
  onOpenSidebar,
}) => {
  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3.5 bg-[#FFFFFF] border-b border-[#E0E7E1] shrink-0">
      <div className="flex items-center gap-3">
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex items-center justify-center p-2 -ml-1 rounded-lg text-[#66736A] hover:text-[#17251D] hover:bg-[#F8F7F2] transition-colors lg:hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#128C4A]"
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
          className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#E7F5EC] border border-[#E0E7E1] text-[#128C4A] shrink-0"
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

        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-[#17251D] leading-tight">
              Business Support
            </h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#E7F5EC] text-[#075E36] border border-[#E0E7E1]">
              Frontend Demo
            </span>
          </div>
          <p className="text-xs text-[#66736A] mt-0.5">
            Operational workspace &amp; communication assistant
          </p>
        </div>
      </div>

      <div className="flex items-center">
        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-2 text-xs font-medium rounded-lg transition-colors border bg-[#FFFFFF] hover:bg-[#E7F5EC] active:bg-[#E0E7E1] text-[#17251D] border-[#E0E7E1] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#128C4A] focus:ring-offset-1"
          aria-label="Start a new conversation"
          title="Start a new conversation"
        >
          <svg
            className="w-4 h-4 text-[#128C4A]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          <span className="hidden sm:inline">New conversation</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>
    </header>
  );
};
