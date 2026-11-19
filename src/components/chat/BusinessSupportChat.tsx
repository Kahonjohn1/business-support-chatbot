"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type {
  ApiChatMessage,
  ApiChatResponse,
  Attachment,
  ChatMessage,
} from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ErrorBanner } from "./ErrorBanner";
import { useSupportSummaryReporter } from "@/components/workspace/SupportSummaryContext";
import { useChatMessages } from "@/hooks/useChatMessages";
import { createMessageId } from "@/lib/chatMessages";
import { clearStoredConversation } from "@/lib/conversationStorage";
import { conversationTitleFromMessages } from "@/lib/conversationPersistence";
import {
  formatApprovalOutcome,
  type ApprovalOutcome,
} from "@/lib/approvalOutcome";
import { MAX_ATTACHMENTS } from "@/lib/chatLimits";
import { buildRequestContext } from "@/lib/requestContext";
import { parseSourceList } from "@/lib/knowledge/sources";
import {
  createAttachmentFromFile,
  releaseAttachmentFiles,
  revokeAttachmentPreview,
  totalAttachmentSizeError,
  validateAttachmentFile,
} from "@/lib/attachments";
import { evaluateSubmission, isStaleResponse } from "@/lib/submission";
import { buildSupportSummary } from "@/lib/supportChannels";

const GENERIC_REQUEST_ERROR =
  "Something went wrong. Please try again.";

/** Tagged error so retryable (5xx/network) failures can be told apart. */
class RequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RequestError";
    this.retryable = retryable;
  }
}

// Transient failures worth retrying: rate limiting (429) and server errors
// (5xx). Validation errors (400/413/415) are not retryable and should not offer
// a Retry button, since resending identical input would fail again.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface BusinessSupportChatProps {
  userId: string;
  conversationId?: string | null;
  initialMessages?: readonly ChatMessage[];
}

export const BusinessSupportChat: React.FC<BusinessSupportChatProps> = ({
  userId,
  conversationId = null,
  initialMessages,
}) => {
  const router = useRouter();
  const storageKey = conversationId ?? "new";

  // The conversation lives in React state, mirrored to a session-scoped copy
  // so a reload resumes it. isHydrated flips once that copy has been restored.
  const {
    messages,
    appendMessage,
    updateMessage,
    clearConversation,
    isHydrated,
  } = useChatMessages({
    initialMessages,
    storageKey,
    userId,
    useStoredSession: !conversationId,
  });

  const persistedCountRef = useRef<number>(initialMessages?.length ?? 0);
  const persistenceBusyRef = useRef<boolean>(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const handleApprovalResolved = useCallback(
    (messageId: string, outcome: ApprovalOutcome) => {
      let approvalStatus: ChatMessage["approvalStatus"];
      if (outcome.status === "executed") {
        approvalStatus = "approved";
      } else if (outcome.status === "rejected") {
        approvalStatus = "rejected";
      } else {
        approvalStatus = "failed";
      }

      updateMessage(messageId, { approvalStatus });
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: formatApprovalOutcome(outcome),
        createdAt: new Date().toISOString(),
      });
    },
    [appendMessage, updateMessage]
  );

  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAnalyzingFiles, setIsAnalyzingFiles] = useState<boolean>(false);
  const [isRetryableError, setIsRetryableError] = useState<boolean>(true);

  // Concise, honest summary of the customer's issue drawn from the conversation,
  // used only when the user chooses to contact human support.
  const supportSummary = useMemo(
    () => buildSupportSummary(messages),
    [messages]
  );
  const reportSupportSummary = useSupportSummaryReporter();

  useEffect(() => {
    reportSupportSummary(supportSummary);
  }, [reportSupportSummary, supportSummary]);

  // Guard to ensure an async reply cannot land in a conversation that was reset.
  const conversationSessionRef = useRef<number>(0);

  // Handle for the in-flight request so it can be aborted safely
  const requestControllerRef = useRef<AbortController | null>(null);

  // Synchronous guard set the moment a submission is accepted, so a second
  // send/retry cannot start before React has rendered the disabled state.
  const submissionLockRef = useRef<boolean>(false);

  // Real File objects for attachments created this session, keyed by attachment
  // id. Never persisted; used to (re)send the file bytes with each request.
  const attachmentFileCacheRef = useRef<Map<string, File>>(new Map());

  // Cancel any pending request if the component unmounts
  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, []);

  // Sends the conversation context to the API and appends the assistant's reply.
  const requestAssistantReply = useCallback(
    async (context: ApiChatMessage[]) => {
      const session = conversationSessionRef.current;

      // Cancel any request that may still be running.
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;

      const includesFiles = context.some(
        (message) => (message.attachmentIds?.length ?? 0) > 0
      );

      setError(null);
      setIsRetryableError(true);
      setIsAnalyzingFiles(includesFiles);
      setIsLoading(true);

      try {
        const formData = new FormData();
        formData.append("payload", JSON.stringify({ messages: context }));
        for (const message of context) {
          for (const id of message.attachmentIds ?? []) {
            const file = attachmentFileCacheRef.current.get(id);
            if (file) {
              formData.append(`file:${id}`, file, file.name);
            }
          }
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = "The assistant could not respond. Please try again.";
          try {
            const errorData = (await response.json()) as { error?: unknown };
            if (typeof errorData.error === "string") {
              message = errorData.error;
            }
          } catch {
            // Keep the generic message when the error body is not JSON.
          }
          throw new RequestError(message, isRetryableStatus(response.status));
        }

        const data = (await response.json()) as ApiChatResponse;
        const rawContent = data.message?.content;
        const content = typeof rawContent === "string" ? rawContent.trim() : "";
        if (!content) {
          throw new RequestError(
            "The assistant returned an empty response. Please try again.",
            true
          );
        }

        // Source metadata is validated before it reaches the interface: an
        // unusable or malformed entry is dropped rather than displayed.
        const sources = parseSourceList(data.message?.sources);
        const insufficientEvidence =
          data.message?.insufficientEvidence === true;

        // Ignore the result if the request was aborted or the conversation was
        // reset meanwhile.
        if (
          isStaleResponse({
            aborted: controller.signal.aborted,
            startSession: session,
            currentSession: conversationSessionRef.current,
          })
        ) {
          return;
        }

        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: "assistant",
          content,
          createdAt: new Date().toISOString(),
          ...(sources.length > 0 ? { sources } : {}),
          ...(insufficientEvidence ? { insufficientEvidence: true } : {}),
          ...(data.message?.pendingApproval ? { pendingApproval: data.message.pendingApproval, approvalStatus: "pending" as const } : {}),
        };
        appendMessage(assistantMessage);

        requestControllerRef.current = null;
        submissionLockRef.current = false;
        setIsLoading(false);
        setIsAnalyzingFiles(false);
      } catch (err) {
        // A cancelled request (reset, unmount) must not surface an error.
        if (
          isStaleResponse({
            aborted: controller.signal.aborted,
            startSession: session,
            currentSession: conversationSessionRef.current,
          })
        ) {
          return;
        }

        requestControllerRef.current = null;
        submissionLockRef.current = false;
        setIsLoading(false);
        setIsAnalyzingFiles(false);
        setIsRetryableError(
          err instanceof RequestError ? err.retryable : true
        );
        setError(
          err instanceof Error && err.message
            ? err.message
            : GENERIC_REQUEST_ERROR
        );
      }
    },
    [appendMessage]
  );

  // Invalidate any in-flight request and clear the transient UI state.
  const resetTransientState = useCallback(() => {
    conversationSessionRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    submissionLockRef.current = false;
    setIsLoading(false);
    setIsAnalyzingFiles(false);
    setIsRetryableError(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isHydrated || persistenceBusyRef.current) return;

    const pending = messages.slice(persistedCountRef.current);
    if (pending.length === 0) return;
    if (!conversationId && !pending.some((message) => message.role === "assistant")) {
      return;
    }

    let cancelled = false;
    persistenceBusyRef.current = true;

    void (async () => {
      try {
        let targetId = conversationId;

        if (!targetId) {
          const createResponse = await fetch("/api/conversations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: conversationTitleFromMessages(messages) }),
          });
          if (!createResponse.ok) throw new Error("create failed");
          const created = (await createResponse.json()) as {
            conversation: { id: string };
          };
          targetId = created.conversation.id;
        }

        const saveResponse = await fetch(
          `/api/conversations/${targetId}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ messages: pending }),
          }
        );
        if (!saveResponse.ok) throw new Error("save failed");
        if (cancelled) return;

        persistedCountRef.current = messages.length;
        setStorageError(null);
        clearStoredConversation(storageKey, userId);
        if (!conversationId) {
          router.replace(`/c/${targetId}`);
          router.refresh();
        }
      } catch {
        if (!cancelled) {
          setStorageError("This conversation could not be saved yet.");
        }
      } finally {
        persistenceBusyRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, isHydrated, messages, router, storageKey, userId]);

  // Release the object URLs of any pending composer attachments and reset them.
  // Only these pending files are dropped from the shared cache; files belonging
  // to messages already sent must remain available for retries.
  const clearComposerAttachments = () => {
    attachments.forEach(revokeAttachmentPreview);
    releaseAttachmentFiles(attachments, attachmentFileCacheRef.current);
    setAttachments([]);
    setAttachmentError(null);
  };

  const handleFilesSelected = (files: FileList) => {
    const selected = Array.from(files);
    if (selected.length === 0) {
      return;
    }

    const errors: string[] = [];
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    if (selected.length > remaining) {
      errors.push(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
    }

    const accepted: Attachment[] = [];
    const acceptedFiles: File[] = [];

    for (const file of selected.slice(0, remaining)) {
      const validationError = validateAttachmentFile(file);
      if (validationError) {
        errors.push(validationError);
        continue;
      }
      accepted.push(createAttachmentFromFile(file));
      acceptedFiles.push(file);
    }

    // Reject a batch that would push the message over the server's combined
    // file limit, before any file bytes are registered or object URLs leak.
    const sizeError = totalAttachmentSizeError([...attachments, ...accepted]);
    if (sizeError) {
      accepted.forEach(revokeAttachmentPreview);
      errors.push(sizeError);
    } else if (accepted.length > 0) {
      accepted.forEach((attachment, index) => {
        attachmentFileCacheRef.current.set(attachment.id, acceptedFiles[index]);
      });
      setAttachments((prev) => [...prev, ...accepted]);
    }
    setAttachmentError(errors.length > 0 ? errors.join(" ") : null);
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((attachment) => attachment.id === id);
    if (target) {
      revokeAttachmentPreview(target);
    }
    attachmentFileCacheRef.current.delete(id);
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    setAttachmentError(null);
  };

  const handleSendMessage = () => {
    // 1. Trim whitespace from the input.
    const trimmed = input.trim();
    const hasAttachments = attachments.length > 0;

    // 2. If there is neither text nor an attachment, do nothing.
    if (!trimmed && !hasAttachments) {
      return;
    }

    // 3. If a submission is already in progress, prevent another. The lock is
    //    set synchronously so a rapid second send cannot slip through before
    //    React re-renders the composer as disabled.
    if (submissionLockRef.current || isLoading) {
      return;
    }

    // 4. Validate the submission and refuse an unanswered-turn follow-up. On
    //    rejection the composer is left untouched so the user can recover.
    const decision = evaluateSubmission({
      messages,
      text: trimmed,
      attachments,
    });
    if (!decision.ok) {
      if (decision.reason === "attachments-too-large") {
        setAttachmentError(decision.message);
        return;
      }
      setIsRetryableError(decision.reason === "awaiting-reply");
      setError(decision.message);
      return;
    }

    submissionLockRef.current = true;

    // 5. Create a user message containing a unique ID, role "user", trimmed content,
    //    ISO timestamp, and any selected attachment metadata.
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      ...(hasAttachments ? { attachments } : {}),
    };

    // 6. Append to the in-memory conversation.
    appendMessage(userMessage);

    // 7. Clear the composer only after the message has been accepted. The attachments
    //    are now part of the message, so their object URLs must not be revoked here.
    setInput("");
    setAttachments([]);
    setAttachmentError(null);

    // 8. Build the bounded request context and request the assistant's reply.
    const context = buildRequestContext(
      [...messages, userMessage],
      attachmentFileCacheRef.current
    );
    void requestAssistantReply(context);
  };

  const handleRetry = useCallback(() => {
    // Do not allow overlapping retries while a request is in progress.
    if (submissionLockRef.current || isLoading || messages.length === 0) {
      return;
    }

    // Re-send the existing history (including the failed user message) without
    // appending a duplicate user message.
    const context = buildRequestContext(
      messages,
      attachmentFileCacheRef.current
    );
    const lastMessage = context[context.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      setIsRetryableError(false);
      setError(
        "This message can no longer be sent because its files are unavailable. Start a new chat and send it again."
      );
      return;
    }

    submissionLockRef.current = true;
    void requestAssistantReply(context);
  }, [isLoading, messages, requestAssistantReply]);

  // When the page reloaded while a reply was still generating, the restored
  // conversation ends on an unanswered user turn. Resume it exactly once so the
  // loading state shows inside the chat and the reply is appended, instead of
  // leaving the user on a turn they can neither answer nor resend.
  const interruptedTurnCheckedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!isHydrated || interruptedTurnCheckedRef.current) {
      return;
    }
    interruptedTurnCheckedRef.current = true;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "user") {
      handleRetry();
    }
  }, [isHydrated, messages, handleRetry]);

  const handleSelectPrompt = (promptText: string) => {
    // Places suggestion text into the message composer without auto-submitting
    setInput(promptText);
    setError(null);
  };

  const handleNewConversation = () => {
    // Discards the conversation along with its session-scoped copy.
    resetTransientState();
    clearComposerAttachments();
    clearConversation();
    setInput("");
    setStorageError(null);
    router.push("/c/new");
  };

  return (
    <section
      aria-label="Marque Technologies Support chat"
      className="relative flex flex-col w-full max-w-6xl h-[680px] sm:h-[740px] md:h-[800px] max-h-[90vh] bg-surface border border-border rounded-2xl overflow-hidden shadow-xs"
    >
      <ChatHeader onNewConversation={handleNewConversation} />

      <ErrorBanner
        message={error}
        onDismiss={() => setError(null)}
        onRetry={isRetryableError ? handleRetry : undefined}
      />

      {storageError ? (
        <p className="shrink-0 bg-danger-subtle px-4 py-2 text-sm text-danger">
          {storageError}
        </p>
      ) : null}

      <main className="flex-1 flex flex-col min-h-0 relative bg-background">
        <MessageList
          messages={messages}
          onSelectPrompt={handleSelectPrompt}
          onApprovalResolved={handleApprovalResolved}
          isLoading={isLoading}
          loadingLabel={isAnalyzingFiles ? "Analyzing files..." : undefined}
        />
      </main>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={handleSendMessage}
        disabled={isLoading}
        attachments={attachments}
        attachmentError={attachmentError}
        onFilesSelected={handleFilesSelected}
        onRemoveAttachment={handleRemoveAttachment}
      />
    </section>
  );
};
