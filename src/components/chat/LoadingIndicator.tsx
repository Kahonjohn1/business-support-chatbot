import React from "react";

interface LoadingIndicatorProps {
  label?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  label = "Generating response...",
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-2.5 my-2 max-w-xs bg-surface border border-border rounded-xl text-xs text-muted-foreground shadow-xs"
    >
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
      </div>
      <span className="font-medium text-foreground">{label}</span>
      <span className="sr-only">Loading</span>
    </div>
  );
};
