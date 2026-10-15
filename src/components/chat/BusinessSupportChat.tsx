"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiChatMessage, Attachment, ChatMessage } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { ErrorBanner } from "./ErrorBanner";
import { ConversationSidebar } from "./ConversationSidebar";
import { useConversations } from "@/hooks/useConversations";
import { createMessageId, deriveConversationTitle } from "@/lib/conversations";
import {
  MAX_ATTACHMENTS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_TOTAL_CHARS,
} from "@/lib/chatLimits";
import {
  createAttachmentFromFile,
  revokeAttachmentPreview,
  validateAttachmentFile,
} from "@/lib/attachments";

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

// Builds the bounded context for a request: the most recent messages that fit
// within the server's limits. Attachments are included only while their bytes
// are still available in the session cache; messages with neither text nor
// usable attachments are dropped so the request never fails validation.
function buildRequestContext(
  messages: ChatMessage[],
  fileCache: Map<string, File>
): ApiChatMessage[] {
  const context: ApiChatMessage[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const content = message.content.trim().slice(0, MAX_MESSAGE_CHARS);
    const attachmentIds = (message.attachments ?? [])
      .filter(
        (attachment) =>
          attachment.contentAvailable && fileCache.has(attachment.id)
      )
      .map((attachment) => attachment.id);

    if (!content && attachmentIds.length === 0) {
      continue;
    }

    // The newest message is always kept, even if it sits exactly at a limit.
    if (context.length > 0) {
      if (context.length >= MAX_MESSAGES) break;
      if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    }

    context.unshift({
      role: message.role,
      content,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
    totalChars += content.length;
  }

  return context;
}

export const BusinessSupportChat: React.FC = () => {
  const {
    conversations,
    appendMessage,
    renameConversation,
    removeConversation,
  } = useConversations();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [input, setInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isAnalyzingFiles, setIsAnalyzingFiles] = useState<boolean>(false);
  const [isRetryableError, setIsRetryableError] = useState<boolean>(true);

  // Guard to ensure an async reply cannot land in a reset or switched conversation
  const conversationSessionRef = useRef<number>(0);

  // Handle for the in-flight request so it can be aborted safely
  const requestControllerRef = useRef<AbortController | null>(null);

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

  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? null,
    [conversations, activeConversationId]
  );

  const messages = activeConversation?.messages ?? [];

  // Sends the conversation context to the API and appends the assistant's reply.
  const requestAssistantReply = useCallback(
    async (conversationId: string, context: ApiChatMessage[]) => {
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
        formData.append(
          "payload",
          JSON.stringify({ conversationId, messages: context })
        );
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
          throw new RequestError(message, response.status >= 500);
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

        // Ignore the result if the conversation was reset or switched meanwhile.
        if (conversationSessionRef.current !== session) {
          return;
        }

        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: "assistant",
          content,
          createdAt: new Date().toISOString(),
        };
        appendMessage(conversationId, assistantMessage, "");

        requestControllerRef.current = null;
        setIsLoading(false);
        setIsAnalyzingFiles(false);
      } catch (err) {
        // A cancelled request (reset, switch, unmount) must not surface an error.
        if (controller.signal.aborted) {
          return;
        }
        if (conversationSessionRef.current !== session) {
          return;
        }

        requestControllerRef.current = null;
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
    setIsLoading(false);
    setIsAnalyzingFiles(false);
    setIsRetryableError(true);
    setError(null);
  }, []);

  // Release the object URLs of any pending composer attachments and reset them.
  const clearComposerAttachments = () => {
    attachments.forEach(revokeAttachmentPreview);
    setAttachments([]);
    setAttachmentError(null);
    attachmentFileCacheRef.current.clear();
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

    for (const file of selected.slice(0, remaining)) {
      const validationError = validateAttachmentFile(file);
      if (validationError) {
        errors.push(validationError);
        continue;
      }
      const attachment = createAttachmentFromFile(file);
      attachmentFileCacheRef.current.set(attachment.id, file);
      accepted.push(attachment);
    }

    if (accepted.length > 0) {
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

    // 3. If a submission is already in progress, prevent another submission.
    if (isLoading) {
      return;
    }

    // 4. Create a user message containing a unique ID, role "user", trimmed content,
    //    ISO timestamp, and any selected attachment metadata.
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      ...(hasAttachments ? { attachments } : {}),
    };

    // 5. Append to the active conversation, or start a new one titled from the message.
    const conversationId = appendMessage(
      activeConversationId,
      userMessage,
      deriveConversationTitle(trimmed || attachments[0]?.name || "")
    );
    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
    }

    // 6. Clear the composer only after the message has been accepted. The attachments
    //    are now part of the message, so their object URLs must not be revoked here.
    setInput("");
    setAttachments([]);
    setAttachmentError(null);

    // 7. Build the bounded request context and request the assistant's reply.
    const context = buildRequestContext(
      [...messages, userMessage],
      attachmentFileCacheRef.current
    );
    void requestAssistantReply(conversationId, context);
  };

  const handleRetry = useCallback(() => {
    // Do not allow overlapping retries while a request is in progress.
    if (isLoading || !activeConversation) {
      return;
    }

    // Re-send the existing history (including the failed user message) without
    // appending a duplicate user message.
    const context = buildRequestContext(
      activeConversation.messages,
      attachmentFileCacheRef.current
    );
    const lastMessage = context[context.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      setIsRetryableError(false);
      setError(
        "This message can no longer be sent because its files are unavailable. Please send it again."
      );
      return;
    }

    void requestAssistantReply(activeConversation.id, context);
  }, [isLoading, activeConversation, requestAssistantReply]);

  const handleSelectPrompt = (promptText: string) => {
    // Places suggestion text into the message composer without auto-submitting
    setInput(promptText);
    setError(null);
  };

  const handleNewConversation = () => {
    // Existing conversations are preserved; only the active view is cleared.
    resetTransientState();
    clearComposerAttachments();
    setActiveConversationId(null);
    setInput("");
  };

  const handleSelectConversation = (id: string) => {
    // Switching conversations cancels any pending demonstration to avoid carrying state over.
    resetTransientState();
    clearComposerAttachments();
    setActiveConversationId(id);
    setInput("");
  };

  const handleRenameConversation = (id: string, title: string) => {
    renameConversation(id, title);
  };

  const handleDeleteConversation = (id: string) => {
    const target = conversations.find((conversation) => conversation.id === id);
    target?.messages.forEach((message) =>
      message.attachments?.forEach((attachment) => {
        revokeAttachmentPreview(attachment);
        attachmentFileCacheRef.current.delete(attachment.id);
      })
    );

    removeConversation(id);

    if (activeConversationId === id) {
      resetTransientState();
      clearComposerAttachments();
      setActiveConversationId(null);
      setInput("");
    }
  };

  return (
    <section
      aria-label="Business Support Chatbot"
      className="relative flex w-full max-w-6xl h-[680px] sm:h-[740px] md:h-[800px] max-h-[90vh] bg-surface border border-border rounded-2xl overflow-hidden shadow-xs"
    >
      {isSidebarOpen && (
        <div
          className="absolute inset-0 z-30 bg-[#17251D]/30 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      <div className="flex flex-col flex-1 min-w-0 bg-surface">
        <ChatHeader
          onNewConversation={handleNewConversation}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />

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
      </div>
    </section>
  );
};
