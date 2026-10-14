import type {
  Attachment,
  AttachmentKind,
  ChatMessage,
  Conversation,
  ConversationGroup,
  MessageRole,
} from "@/types/chat";

const STORAGE_KEY = "business-support-chatbot:conversations";
const MAX_TITLE_LENGTH = 48;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function deriveConversationTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "New Chat";
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}\u2026`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant";
}

function isAttachmentKind(value: unknown): value is AttachmentKind {
  return value === "image" || value === "document";
}

// Attachments are restored as metadata only. File bytes (and their object URLs)
// are never persisted, so restored attachments are marked as unavailable.
function normalizeAttachment(value: unknown): Attachment | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.type !== "string" ||
    typeof value.size !== "number" ||
    !isAttachmentKind(value.kind)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    size: value.size,
    type: value.type,
    kind: value.kind,
    contentAvailable: false,
  };
}

function normalizeAttachments(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .map(normalizeAttachment)
    .filter((attachment): attachment is Attachment => attachment !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !isMessageRole(value.role) ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }

  const attachments = normalizeAttachments(value.attachments);

  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    ...(attachments ? { attachments } : {}),
  };
}

function normalizeConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !Array.isArray(value.messages)) {
    return null;
  }

  const messages = value.messages
    .map(normalizeMessage)
    .filter((message): message is ChatMessage => message !== null);

  const createdAt =
    typeof value.createdAt === "string"
      ? value.createdAt
      : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;

  const storedTitle =
    typeof value.title === "string" ? value.title.trim() : "";
  const title =
    storedTitle ||
    (messages.length > 0
      ? deriveConversationTitle(messages[0].content)
      : "New Chat");

  return { id: value.id, title, messages, createdAt, updatedAt };
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeConversation)
      .filter((conversation): conversation is Conversation => conversation !== null);
  } catch {
    return [];
  }
}

// Strip runtime-only fields (object URLs / availability flags) before writing
// to localStorage so only safe, serializable metadata is persisted.
interface StoredAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
}

function toStoredAttachment(attachment: Attachment): StoredAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    kind: attachment.kind,
  };
}

function toStoredMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map(toStoredAttachment) }
      : {}),
  };
}

function toStoredConversation(conversation: Conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(toStoredMessage),
  };
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(conversations.map(toStoredConversation))
    );
  } catch {
    // Persistence is best-effort; the chat keeps working in memory.
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function groupConversationsByDate(
  conversations: Conversation[],
  now: Date = new Date()
): ConversationGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const previousWeekStart = todayStart - 7 * DAY_MS;

  const buckets: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  for (const conversation of conversations) {
    const updated = new Date(conversation.updatedAt).getTime();

    if (Number.isNaN(updated) || updated >= todayStart) {
      buckets.Today.push(conversation);
    } else if (updated >= yesterdayStart) {
      buckets.Yesterday.push(conversation);
    } else if (updated >= previousWeekStart) {
      buckets["Previous 7 days"].push(conversation);
    } else {
      buckets.Older.push(conversation);
    }
  }

  const byMostRecent = (a: Conversation, b: Conversation) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  return (Object.keys(buckets) as Array<keyof typeof buckets>)
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({
      label,
      conversations: [...buckets[label]].sort(byMostRecent),
    }));
}

export function formatConversationTime(
  iso: string,
  now: Date = new Date()
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return "Just now";

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  if (date.getTime() >= startOfDay(now)) {
    return `${Math.floor(diffMinutes / 60)}h ago`;
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
