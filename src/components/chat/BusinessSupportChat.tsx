"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ApiChatMessage, Attachment, ChatMessage } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ErrorBanner } from "./ErrorBanner";
import { useChatMessages } from "@/hooks/useChatMessages";
import { createMessageId } from "@/lib/chatMessages";
import { MAX_ATTACHMENTS } from "@/lib/chatLimits";
import { buildRequestContext } from "@/lib/requestContext";
import {
  createAttachmentFromFile,
  releaseAttachmentFiles,
  revokeAttachmentPreview,
  totalAttachmentSizeError,
  validateAttachmentFile,
} from "@/lib/attachments";
import { evaluateSubmission, isStaleResponse } from "@/lib/submission";

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

export const BusinessSupportChat: React.FC = () => {
  // The conversation lives in memory only; nothing is persisted, so a refresh
  // always starts a new, empty chat.
  const { messages, appendMessage, clearConversation } = useChatMessages();

  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAnalyzingFiles, setIsAnalyzingFiles] = useState<boolean>(false);
  const [isRetryableError, setIsRetryableError] = useState<boolean>(true);

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

        const data = (await response.json()) as {
          message?: { content?: unknown };
        };
        const rawContent = data.message?.content;
        const content = typeof rawContent === "string" ? rawContent.trim() : "";
        if (!content) {
          throw new RequestError(
            "The assistant returned an empty response. Please try again.",
            true
          );
        }

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

  const handleSelectPrompt = (promptText: string) => {
    // Places suggestion text into the message composer without auto-submitting
    setInput(promptText);
    setError(null);
  };

  const handleNewConversation = () => {
    // The conversation is in memory only, so starting a new chat discards it.
    resetTransientState();
    clearComposerAttachments();
    clearConversation();
    setInput("");
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

      <main className="flex-1 flex flex-col min-h-0 relative bg-background">
        <MessageList
          messages={messages}
          onSelectPrompt={handleSelectPrompt}
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
