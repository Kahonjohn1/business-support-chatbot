import React, { useRef } from "react";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Write a message for your business...",
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If composing with an IME (e.g. Japanese/Chinese input), do not trigger send
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim().length > 0) {
        onSend();
      }
    }
  };

  const isSendDisabled = disabled || value.trim().length === 0;

  return (
    <footer className="p-3 sm:p-4 bg-[#FFFFFF] border-t border-[#E0E7E1] shrink-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSendDisabled) {
            onSend();
          }
        }}
        className="flex flex-col gap-2"
        aria-label="Message composer form"
      >
        <div className="relative flex items-end gap-2 p-2.5 sm:p-3 bg-[#F8F7F2] border border-[#E0E7E1] rounded-2xl transition-all focus-within:border-[#128C4A] focus-within:ring-2 focus-within:ring-[#128C4A]/20">
          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 bg-transparent border-0 resize-none text-sm text-[#17251D] placeholder:text-[#66736A] focus:outline-none min-h-[44px] max-h-36 leading-relaxed"
            aria-label="Write a message for your business"
          />

          <button
            type="submit"
            disabled={isSendDisabled}
            className={`inline-flex items-center justify-center p-2.5 rounded-xl font-medium transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-1 ${
              isSendDisabled
                ? "bg-[#E0E7E1] text-[#66736A] cursor-not-allowed opacity-70"
                : "bg-[#128C4A] hover:bg-[#075E36] active:bg-[#075E36] text-[#FFFFFF] shadow-xs cursor-pointer"
            }`}
            aria-label="Send message"
            title="Send message"
          >
            <svg
              className="w-4 h-4 transform rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19V5m0 0l-7 7m7-7l7 7"
              />
            </svg>
          </button>
        </div>

        <div className="flex items-center justify-between px-1 text-[11px] text-[#66736A]">
          <span>Press Enter to send, Shift + Enter for new line</span>
          {value.length > 0 && (
            <span aria-live="polite">{value.length} characters</span>
          )}
        </div>
      </form>
    </footer>
  );
};
