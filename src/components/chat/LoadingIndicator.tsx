import React from "react";

interface LoadingIndicatorProps {
  label?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  label = "Demonstrating pending state...",
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-2.5 my-2 max-w-xs bg-[#FFFFFF] border border-[#E0E7E1] rounded-xl text-xs text-[#66736A] shadow-xs"
    >
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-[#128C4A] animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 rounded-full bg-[#128C4A] animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 rounded-full bg-[#128C4A] animate-bounce" />
      </div>
      <span className="font-medium text-[#17251D]">{label}</span>
      <span className="sr-only">Loading</span>
    </div>
  );
};
