import React, { useEffect, useState } from "react";
import {
  SUPPORT_CHANNELS,
  resolveSupportChannelHref,
  type SupportChannel,
} from "@/lib/supportChannels";

interface HumanSupportProps {
  id?: string;
  summary: string;
  onClose: () => void;
}

// Presents the approved human-support channels and an optional, copyable summary
// of the conversation. It never sends anything on its own: every channel is a
// plain link the user chooses to follow, and the summary is copied only when the
// user asks. See src/lib/supportChannels.ts for the single source of contact
// details.
export const HumanSupport: React.FC<HumanSupportProps> = ({
  id,
  summary,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      // The Clipboard API can be unavailable (e.g. an insecure context). The
      // summary stays visible and selectable so it can be copied manually.
    }
  };

  const opensInNewTab = (channel: SupportChannel) =>
    channel.id === "whatsapp" || channel.id === "website";

  return (
    <div
      id={id}
      role="region"
      aria-label="Contact support options"
      className="absolute left-4 sm:left-6 top-full z-30 mt-2 w-72 max-w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Contact human support
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Reach the Marque Technologies team directly. Nothing is sent
            automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="Close contact support"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <ul className="mt-3 grid gap-2">
        {SUPPORT_CHANNELS.map((channel) => {
          const href = resolveSupportChannelHref(channel, summary);
          const newTab = opensInNewTab(channel);
          return (
            <li key={channel.id}>
              <a
                href={href}
                onClick={onClose}
                target={newTab ? "_blank" : undefined}
                rel={newTab ? "noopener noreferrer" : undefined}
                className="flex h-full flex-col rounded-xl border border-border bg-background px-3 py-2.5 transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label={`${channel.label}: ${channel.value}`}
              >
                <span className="text-xs font-semibold text-foreground">
                  {channel.label}
                </span>
                <span className="mt-0.5 text-[11px] break-words text-muted-foreground">
                  {channel.value}
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      {summary && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Summary for support
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-surface px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent active:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
              aria-label="Copy support summary"
            >
              {copied ? "Copied" : "Copy summary"}
            </button>
          </div>
          <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background px-3 py-2 text-[11px] leading-relaxed text-foreground">
            {summary}
          </pre>
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? "Support summary copied to clipboard" : ""}
          </span>
        </div>
      )}
    </div>
  );
};
