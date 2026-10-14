import React from "react";
import { PromptSuggestion } from "@/types/chat";

interface EmptyStateProps {
  onSelectPrompt: (promptText: string) => void;
}

const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  {
    id: "draft-email",
    text: "Draft a professional email",
  },
  {
    id: "improve-message",
    text: "Improve a business message",
  },
  {
    id: "summarize-notes",
    text: "Summarize meeting notes",
  },
  {
    id: "action-items",
    text: "Organize ideas into action items",
  },
];

export const EmptyState: React.FC<EmptyStateProps> = ({ onSelectPrompt }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 sm:px-6 py-8 text-center max-w-xl mx-auto my-auto">
      {/* Icon */}
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-accent border border-border mb-5">
        <svg
          className="w-7 h-7 text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a.75.75 0 01-.847-.847c.18-.89.475-1.745.87-2.54A8.026 8.026 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          />
        </svg>
      </div>

      {/* Heading & Supporting Text */}
      <h2 className="text-xl sm:text-2xl font-semibold text-foreground tracking-tight">
        How can we help your business today?
      </h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md leading-relaxed">
        Draft communications, refine your writing, and organize your ideas in one place.
      </p>

      {/* 4 Clickable Prompt Suggestions */}
      <div className="w-full mt-7">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PROMPT_SUGGESTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectPrompt(item.text)}
              className="flex items-center justify-between p-3.5 bg-surface hover:bg-accent active:bg-muted border border-border rounded-xl text-left transition-colors group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <span className="text-sm font-medium text-foreground group-hover:text-accent-foreground">
                {item.text}
              </span>
              <svg
                className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 ml-2 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
