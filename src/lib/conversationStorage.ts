import type {
  Attachment,
  ChatMessage,
  MessageRole,
  PendingApprovalInfo,
} from "@/types/chat";
import { parseSourceList } from "@/lib/knowledge/sources";

// Session-scoped copy of the active conversation so an accidental page reload
// resumes where the user left off instead of wiping the chat. Only serialisable
// metadata is stored: file bytes and object URLs never survive the page
// lifecycle, so restored attachments always report their content as unavailable.
// Nothing here is shared between browser tabs, and starting a new chat removes
// the copy.

export const STORAGE_KEY = "business-support-chatbot:conversation:v1";
const SCHEMA_VERSION = 1;

function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    return sessionStorage;
  } catch {
    // Storage can be blocked by browser settings; the chat still works.
    return null;
  }
}

function isMessageRole(value: unknown): value is MessageRole {
  return value === "user" || value === "assistant";
}

/** Rebuilds an attachment without any byte-backed fields. */
function parseAttachment(value: unknown): Attachment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }
  if (typeof candidate.name !== "string") return null;
  if (typeof candidate.size !== "number" || !Number.isFinite(candidate.size)) {
    return null;
  }
  if (typeof candidate.type !== "string") return null;
  if (candidate.kind !== "image" && candidate.kind !== "document") {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    size: candidate.size,
    type: candidate.type,
    kind: candidate.kind,
    contentAvailable: false,
  };
}

type StoredApprovalStatus = NonNullable<ChatMessage["approvalStatus"]>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApprovalStatus(value: unknown): value is StoredApprovalStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "failed"
  );
}

function parsePendingApproval(value: unknown): PendingApprovalInfo | null {
  if (!isPlainRecord(value)) return null;

  const { approvalId, toolName, summary, details } = value;
  if (
    typeof approvalId !== "string" ||
    !approvalId.trim() ||
    approvalId.length > 256
  ) {
    return null;
  }
  if (
    typeof toolName !== "string" ||
    !toolName.trim() ||
    toolName.length > 100
  ) {
    return null;
  }
  if (
    typeof summary !== "string" ||
    !summary.trim() ||
    summary.length > 500
  ) {
    return null;
  }
  if (!isPlainRecord(details)) return null;

  return {
    approvalId,
    toolName,
    summary,
    details: { ...details },
  };
}

/** Rebuilds a message only when every field validates; otherwise null. */
function parseMessage(value: unknown): ChatMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }
  if (!isMessageRole(candidate.role)) return null;
  if (typeof candidate.content !== "string") return null;
  if (
    typeof candidate.createdAt !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAt))
  ) {
    return null;
  }

  const message: ChatMessage = {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    createdAt: candidate.createdAt,
  };

  if (candidate.attachments !== undefined) {
    if (!Array.isArray(candidate.attachments)) return null;
    const attachments: Attachment[] = [];
    for (const raw of candidate.attachments) {
      const attachment = parseAttachment(raw);
      if (!attachment) return null;
      attachments.push(attachment);
    }
    message.attachments = attachments;
  }

  // Source metadata is validated on restore: unusable entries are dropped, so
  // a corrupted copy can never put a fabricated citation on screen.
  const sources = parseSourceList(candidate.sources);
  if (sources.length > 0) {
    message.sources = sources;
  }

  if (candidate.insufficientEvidence === true) {
    message.insufficientEvidence = true;
  }

  const pendingApproval = parsePendingApproval(candidate.pendingApproval);
  if (pendingApproval && isApprovalStatus(candidate.approvalStatus)) {
    message.pendingApproval = pendingApproval;
    message.approvalStatus = candidate.approvalStatus;
  }

  return message;
}

/** Stores only plain fields; object URLs are never serialised. */
function serializeMessage(message: ChatMessage): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
  if (message.attachments && message.attachments.length > 0) {
    stored.attachments = message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      kind: attachment.kind,
      contentAvailable: false,
    }));
  }
  if (message.sources && message.sources.length > 0) {
    stored.sources = message.sources.map((source) => ({
      id: source.id,
      title: source.title,
      ...(source.section ? { section: source.section } : {}),
    }));
  }
  if (message.insufficientEvidence) {
    stored.insufficientEvidence = true;
  }
  if (message.pendingApproval && message.approvalStatus) {
    stored.pendingApproval = {
      approvalId: message.pendingApproval.approvalId,
      toolName: message.pendingApproval.toolName,
      summary: message.pendingApproval.summary,
      details: message.pendingApproval.details,
    };
    stored.approvalStatus = message.approvalStatus;
  }
  return stored;
}

function resolveStorageKey(key?: string, userId?: string): string {
  const scope = userId?.trim();
  const base = scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY;
  return key ? `${base}:${key}` : base;
}

/** Mirrors the conversation. An empty conversation removes the stored copy. */
export function saveConversation(
  messages: readonly ChatMessage[],
  key?: string,
  userId?: string
): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const storageKey = resolveStorageKey(key, userId);
    if (messages.length === 0) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(
      storageKey,
      JSON.stringify({
        version: SCHEMA_VERSION,
        messages: messages.map(serializeMessage),
      })
    );
  } catch {
    // Quota or blocked storage must never break the chat.
  }
}

/**
 * Returns the stored conversation, or null when there is none to restore.
 * The copy is accepted only when the whole history validates: a partial,
 * re-aligned history could contain two user turns in a row, which the
 * conversation rules forbid.
 */
export function loadConversation(
  key?: string,
  userId?: string
): ChatMessage[] | null {
  try {
    const storage = getStorage();
    if (!storage) return null;

    const raw = storage.getItem(resolveStorageKey(key, userId));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const envelope = parsed as Record<string, unknown>;
    if (envelope.version !== SCHEMA_VERSION) return null;
    if (!Array.isArray(envelope.messages)) return null;
    if (envelope.messages.length === 0) return null;

    const messages: ChatMessage[] = [];
    for (const rawMessage of envelope.messages) {
      const message = parseMessage(rawMessage);
      if (!message) return null;
      messages.push(message);
    }
    return messages;
  } catch {
    // Corrupt or unreadable data behaves like an absent copy.
    return null;
  }
}

/** Discards the stored copy (new conversation, explicit clear). */
export function clearStoredConversation(key?: string, userId?: string): void {
  try {
    getStorage()?.removeItem(resolveStorageKey(key, userId));
  } catch {
    // Nothing to do when storage is unavailable.
  }
}
