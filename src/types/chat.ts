export type MessageRole = "user" | "assistant";

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
}

export interface ChatState {
  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  error: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

export interface PromptSuggestion {
  id: string;
  text: string;
}
