// Verified, company-approved human-support contact channels. This is the single
// source of truth for these details: the assistant's system instruction and the
// UI both read from here so the values can never drift apart or be duplicated
// around the app. Kept pure (no React, no `server-only`) so it can be unit-tested
// directly.
//
// Do not invent additional channels, business hours, response times, or
// policies. Only the details below are approved.

import type { MessageRole } from "@/types/chat";

/** Nigerian local-format number shown in the interface. */
export const SUPPORT_WHATSAPP_NUMBER = "09031261536";

/** International-format WhatsApp link (E.164 without the leading "+"). */
export const SUPPORT_WHATSAPP_URL = "https://wa.me/2349031261536";

export const SUPPORT_EMAIL = "info@marquetechnologies.com";

export const SUPPORT_EMAIL_URL = "mailto:info@marquetechnologies.com";

export const SUPPORT_WEBSITE_URL =
  "https://www.marquetechnologies.com/#solutions";

/** Short, human-readable label for the website link. */
export const SUPPORT_WEBSITE_LABEL = "marquetechnologies.com";

export type SupportChannelId = "whatsapp" | "email" | "website";

export interface SupportChannel {
  id: SupportChannelId;
  label: string;
  /** Value displayed to the user (local phone number, address, or domain). */
  value: string;
  /** Clickable URL used when there is no conversation summary to attach. */
  href: string;
}

/** The approved channels, in the order they should be presented. */
export const SUPPORT_CHANNELS: readonly SupportChannel[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    value: SUPPORT_WHATSAPP_NUMBER,
    href: SUPPORT_WHATSAPP_URL,
  },
  {
    id: "email",
    label: "Email",
    value: SUPPORT_EMAIL,
    href: SUPPORT_EMAIL_URL,
  },
  {
    id: "website",
    label: "Website",
    value: SUPPORT_WEBSITE_LABEL,
    href: SUPPORT_WEBSITE_URL,
  },
];

/** Support email subject line, reused for prefilled mailto links. */
export const SUPPORT_EMAIL_SUBJECT =
  "Support request from the Marque Technologies chatbot";

/** Longest content taken from a single message when building the summary. */
const SUMMARY_PER_MESSAGE_LIMIT = 280;

export interface SupportSummaryMessage {
  role: MessageRole;
  content: string;
  attachments?: readonly unknown[];
}

function compact(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SUMMARY_PER_MESSAGE_LIMIT) {
    return normalized;
  }
  return `${normalized
    .slice(0, SUMMARY_PER_MESSAGE_LIMIT - 1)
    .trimEnd()}…`;
}

/**
 * Builds a concise, honest summary of the customer's issue from the in-memory
 * conversation. Only the user's own words are used (never the assistant's), so
 * the summary cannot fabricate troubleshooting or company details. Returns an
 * empty string when there is nothing to summarize.
 */
export function buildSupportSummary(
  messages: readonly SupportSummaryMessage[]
): string {
  const userTurns: string[] = [];

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = compact(message.content);
    if (text) {
      userTurns.push(text);
      continue;
    }
    const fileCount = message.attachments?.length ?? 0;
    if (fileCount > 0) {
      userTurns.push(
        `[Sent ${fileCount} file${fileCount === 1 ? "" : "s"} for analysis]`
      );
    }
  }

  if (userTurns.length === 0) {
    return "";
  }

  const issue = userTurns[0];
  const hasFollowUp = userTurns.length > 1;
  const remainingQuestion = hasFollowUp ? userTurns[userTurns.length - 1] : "";
  const attempted = userTurns.slice(
    1,
    hasFollowUp ? userTurns.length - 1 : userTurns.length
  );

  const lines = [`Issue: ${issue}`];
  if (attempted.length > 0) {
    lines.push("Details and steps shared:");
    for (const step of attempted) {
      lines.push(`- ${step}`);
    }
  }
  if (remainingQuestion) {
    lines.push(`Remaining question: ${remainingQuestion}`);
  }
  return lines.join("\n");
}

/** WhatsApp deep link, optionally prefilled with the conversation summary. */
export function whatsappSupportLink(summary?: string): string {
  const text = summary?.trim();
  return text
    ? `${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(text)}`
    : SUPPORT_WHATSAPP_URL;
}

/** mailto link, optionally prefilled with the conversation summary as the body. */
export function emailSupportLink(summary?: string): string {
  const subject = encodeURIComponent(SUPPORT_EMAIL_SUBJECT);
  const text = summary?.trim();
  const body = text ? `&body=${encodeURIComponent(text)}` : "";
  return `${SUPPORT_EMAIL_URL}?subject=${subject}${body}`;
}

/** Resolves the clickable link for a channel, attaching the summary when useful. */
export function resolveSupportChannelHref(
  channel: SupportChannel,
  summary?: string
): string {
  switch (channel.id) {
    case "whatsapp":
      return whatsappSupportLink(summary);
    case "email":
      return emailSupportLink(summary);
    default:
      return channel.href;
  }
}
