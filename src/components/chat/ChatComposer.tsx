import React, { useRef } from "react";
import type { Attachment } from "@/types/chat";
import { ACCEPTED_FILE_INPUT } from "@/lib/attachments";
import { MAX_MESSAGE_CHARS } from "@/lib/chatLimits";
import { AttachmentChip } from "./AttachmentChip";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachments: Attachment[];
  attachmentError: string | null;
  onFilesSelected: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Describe your issue or ask a question...",
  attachments = [],
  attachmentError,
  onFilesSelected,
  onRemoveAttachment,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasText = value.trim().length > 0;
  const hasAttachments = attachments.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If composing with an IME (e.g. Japanese/Chinese input), do not trigger send
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && (hasText || hasAttachments)) {
        onSend();
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
    }
    // Reset so the same file can be picked again after removal.
    e.target.value = "";
  };

  const isSendDisabled = disabled || (!hasText && !hasAttachments);

  return (
    <footer className="p-3 sm:p-4 bg-surface border-t border-border shrink-0">
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
        {hasAttachments && (
          <ul
            className="flex flex-wrap gap-2"
            aria-label="Selected attachments"
          >
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <AttachmentChip
                  attachment={attachment}
                  onRemove={onRemoveAttachment}
                />
              </li>
            ))}
          </ul>
        )}

        {attachmentError && (
          <p
            role="alert"
            className="flex items-start gap-1.5 px-1 text-[11px] text-danger"
          >
            <svg
              className="w-3.5 h-3.5 mt-0.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.4 14.55A1.5 1.5 0 003.24 21h17.52a1.5 1.5 0 001.3-2.26L13.66 3.94a1.5 1.5 0 00-2.6 0z"
              />
            </svg>
            <span>{attachmentError}</span>
          </p>
        )}

        <div className="relative flex items-end gap-2 p-2.5 sm:p-3 bg-background border border-border rounded-2xl transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_INPUT}
            onChange={handleFileInputChange}
            className="sr-only"
            tabIndex={-1}
            aria-label="Attach files"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className={`inline-flex items-center justify-center p-2.5 rounded-xl transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
              disabled
                ? "text-muted-foreground opacity-60 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
            }`}
            aria-label="Attach files"
            title="Attach files"
          >
            <svg
              className="w-4.5 h-4.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.9}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
              />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-0 resize-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[44px] max-h-36 leading-relaxed"
            aria-label="Write your message"
          />

          <button
            type="submit"
            disabled={isSendDisabled}
            className={`inline-flex items-center justify-center p-2.5 rounded-xl font-medium transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 ${
              isSendDisabled
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-70"
                : "bg-primary hover:bg-primary-hover active:bg-primary-hover text-primary-foreground shadow-xs cursor-pointer"
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

        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
          <span>Press Enter to send, Shift + Enter for new line</span>
          {value.length > 0 && (
            <span aria-live="polite">
              {value.length} / {MAX_MESSAGE_CHARS} characters
            </span>
          )}
        </div>
      </form>
    </footer>
  );
};
