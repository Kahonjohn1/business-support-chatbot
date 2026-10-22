export type MessageRole = "user" | "assistant";

/**
 * A document the assistant consulted while answering. The id identifies an
 * approved knowledge-base document, and the title and section come from that
 * document, so nothing here is invented.
 */
export interface ChatSource {
  /** Approved document identifier, e.g. "KB-003". */
  id: string;
  /** Document title as published in the approved knowledge base. */
  title: string;
  /** Section of the document the answer drew on, when known. */
  section?: string;
}

/** Minimal message shape exchanged with the chat API (no ids/timestamps). */
export interface ApiChatMessage {
  role: MessageRole;
  content: string;
  /** Ids of attachments whose file bytes are still available for this turn. */
  attachmentIds?: string[];
}

/** The assistant reply returned by the chat API. */
export interface ApiChatResponse {
  message: {
    role: "assistant";
    content: string;
    /** Documents consulted for this answer. Absent when none were used. */
    sources?: ChatSource[];
    /** True when the approved knowledge base does not document the answer. */
    insufficientEvidence?: boolean;
  };
}

export type AttachmentKind = "image" | "document";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
  /** In-memory object URL used for image thumbnails. Never persisted. */
  previewUrl?: string;
  /** False once restored from storage, because file bytes are not persisted. */
  contentAvailable: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments?: Attachment[];
  /** Approved documents consulted for this reply, when any were used. */
  sources?: ChatSource[];
  /** True when the approved knowledge base does not document the answer. */
  insufficientEvidence?: boolean;
}

export interface PromptSuggestion {
  id: string;
  text: string;
}
