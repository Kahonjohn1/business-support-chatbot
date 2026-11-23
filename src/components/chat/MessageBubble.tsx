import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ChatMessage } from "@/types/chat";
import type { ApprovalOutcome } from "@/lib/approvalOutcome";
import { AttachmentChip } from "./AttachmentChip";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface MessageBubbleProps {
  message: ChatMessage;
  onApprovalResolved?: (messageId: string, outcome: ApprovalOutcome) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onApprovalResolved,
}) => {
  const isUser = message.role === "user";
  const attachments = message.attachments ?? [];
  const hasContent = message.content.trim().length > 0;
  const sources = useMemo(
    () => (message.sources ?? []).filter((source) => source.id && source.title),
    [message.sources]
  );
  const formattedTime = useMemo(() => {
    try {
      const date = new Date(message.createdAt);
      return isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [message.createdAt]);

  const contentRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const text = contentRef.current?.innerText.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const [localApprovalStatus, setLocalApprovalStatus] = useState<
    ChatMessage["approvalStatus"]
  >(undefined);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const decisionRequestRef = useRef(0);
  const approvalStatus = localApprovalStatus ?? message.approvalStatus;

  useEffect(
    () => () => {
      decisionRequestRef.current += 1;
    },
    []
  );
  const pending =
    Boolean(message.pendingApproval) &&
    (!approvalStatus || approvalStatus === "pending");
  const approvalResolved =
    Boolean(message.pendingApproval) &&
    approvalStatus !== undefined &&
    approvalStatus !== "pending";

  const handleDecision = async (decision: "approve" | "reject") => {
    if (!message.pendingApproval || isSubmittingDecision) return;

    const requestId = decisionRequestRef.current + 1;
    decisionRequestRef.current = requestId;
    setIsSubmittingDecision(true);
    setApprovalError(null);

    try {
      const resp = await fetch("/api/approvals/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalId: message.pendingApproval.approvalId,
          decision,
        }),
      });

      let result: unknown = null;
      try {
        result = await resp.json();
      } catch {}

      if (!mountedRef.current || decisionRequestRef.current !== requestId) return;

      if (!resp.ok) {
        const messageText =
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "The approval decision could not be processed. Please try again.";

        if (isRecord(result) && result.status === "failed") {
          setLocalApprovalStatus("failed");
          setApprovalError(messageText);
          onApprovalResolved?.(message.id, {
            status: "failed",
            approvalId: message.pendingApproval.approvalId,
            error: messageText,
          });
          return;
        }

        setApprovalError(messageText);
        return;
      }

      const serverStatus =
        isRecord(result) && typeof result.status === "string"
          ? result.status
          : null;
      const confirmed =
        decision === "approve"
          ? serverStatus === "executed"
          : serverStatus === "rejected";
      if (!confirmed) {
        setApprovalError(
          "The approval decision could not be confirmed. Please try again."
        );
        return;
      }

      const executedResult = isRecord(result) ? result.result : undefined;
      setLocalApprovalStatus(decision === "approve" ? "approved" : "rejected");
      onApprovalResolved?.(message.id, {
        status: decision === "approve" ? "executed" : "rejected",
        approvalId: message.pendingApproval.approvalId,
        result: executedResult,
      });
    } catch {
      if (mountedRef.current && decisionRequestRef.current === requestId) {
        setApprovalError(
          "Could not reach the approval service. Please check your connection and try again."
        );
      }
    } finally {
      if (mountedRef.current && decisionRequestRef.current === requestId) {
        setIsSubmittingDecision(false);
      }
    }
  };

  return (
    <div
      className={`flex flex-col my-2 sm:my-3 ${isUser ? "items-end" : "items-start"}`}
    >
      {/* Bubble Metadata */}
      <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">
          {isUser ? "You" : "Business Support"}
        </span>
        {formattedTime && (
          <>
            <span>•</span>
            <time dateTime={message.createdAt}>{formattedTime}</time>
          </>
        )}
      </div>

      {/* Bubble Content */}
      {hasContent && (
        <div
          ref={isUser ? undefined : contentRef}
          className={`relative max-w-[85%] sm:max-w-[75%] md:max-w-[70%] px-4 sm:px-4.5 py-3 rounded-2xl text-sm leading-relaxed shadow-xs ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-xs"
              : "bg-surface text-foreground border border-border rounded-tl-xs"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <ReactMarkdown
              className="message-markdown break-words"
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      )}

      {!isUser && hasContent && (
        <div className="relative mt-1 flex max-w-[85%] sm:max-w-[75%] md:max-w-[70%] items-center px-1">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Response copied to clipboard" : "Copy response"}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copied!</span>
              </>
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? "Response copied to clipboard" : ""}
          </span>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-2 max-w-[85%] sm:max-w-[75%] md:max-w-[70%]" aria-label="Attached files">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentChip attachment={attachment} />
            </li>
          ))}
        </ul>
      )}

      {/* Sources */}
      {!isUser && sources.length > 0 && (
        <div className="mt-1.5 max-w-[85%] sm:max-w-[75%] md:max-w-[70%]">
          <p className="text-[11px] font-medium text-muted-foreground">Sources consulted</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground" aria-label="Sources consulted">
            {sources.map((source) => (
              <li key={source.id}>
                <span className="font-medium text-foreground">{source.title}</span>
                {source.section && <span> — {source.section}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Insufficient evidence */}
      {!isUser && message.insufficientEvidence && (
        <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
          The approved knowledge base does not specify this detail.
        </p>
      )}

      {/* Default-analysis note for file-only turns */}
      {isUser && !hasContent && attachments.length > 0 && (
        <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
          No message — sent for automatic analysis.
        </p>
      )}

      {/* Pending approval UI */}
      {pending && message.pendingApproval && (
        <div className="mt-2 p-2 border rounded bg-muted">
          <p className="text-sm font-medium">{message.pendingApproval.summary}</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => handleDecision("approve")}
              disabled={isSubmittingDecision}
            >
              {isSubmittingDecision ? "Submitting..." : "Approve"}
            </button>
            <button
              type="button"
              className="px-3 py-1 text-sm bg-destructive text-destructive-foreground rounded disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => handleDecision("reject")}
              disabled={isSubmittingDecision}
            >
              Reject
            </button>
          </div>
          {approvalError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {approvalError}
            </p>
          )}
        </div>
      )}

      {approvalResolved && message.pendingApproval && (
        <div className="mt-2 p-2 border rounded bg-muted">
          <p className="text-sm font-medium">{message.pendingApproval.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {approvalStatus === "approved" && "Approved and executed."}
            {approvalStatus === "rejected" && "Rejected. No changes were made."}
            {approvalStatus === "failed" && "Execution failed. See the report below."}
          </p>
          {approvalError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {approvalError}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
