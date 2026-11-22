import type {
  Attachment,
  ChatMessage,
  ChatSource,
  MessageRole,
  PendingApprovalInfo,
} from "@/types/chat";

export interface ConversationRecord {
  readonly id: string;
  readonly title: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ConversationListItem {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageRecord {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly created_at: string;
  readonly attachments: unknown;
  readonly sources: unknown;
  readonly insufficient_evidence: boolean | null;
  readonly pending_approval: boolean | null;
  readonly approval_status: string | null;
  readonly client_message_id?: string;
  readonly ordinal?: number;
  readonly approval_metadata?: unknown;
}

export interface MessageInsert {
  readonly conversation_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly attachments: Attachment[];
  readonly sources: ChatSource[];
  readonly insufficient_evidence: boolean;
  readonly pending_approval: boolean;
  readonly approval_status: ChatMessage["approvalStatus"] | null;
  readonly client_message_id: string;
  readonly ordinal: number;
  readonly approval_metadata: Record<string, unknown>;
  readonly sender_id: string;
}

const APPROVAL_STATUSES: readonly NonNullable<ChatMessage["approvalStatus"]>[] = [
  "pending",
  "approved",
  "rejected",
  "failed",
];

const MAX_CLIENT_MESSAGE_ID_LENGTH = 256;
const MAX_MESSAGE_CONTENT_LENGTH = 40000;

export interface SavedMessageIdentity {
  readonly clientMessageId: string;
  readonly id?: string;
}

export type SavedMessageIdentityResult =
  | { readonly ok: true; readonly saved: SavedMessageIdentity[] }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value !== "object" || value === null || Array.isArray(value)
    ? false
    : true;
}

type ClientMessageIdResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string };

function resolveClientMessageId(
  message: Pick<ChatMessage, "id" | "clientMessageId">
): ClientMessageIdResult {
  const value = message.clientMessageId ?? message.id;
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "Invalid message id." };
  }
  if (Array.from(value).length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
    return { ok: false, error: "Message id is too long." };
  }
  return { ok: true, id: value };
}

export type MessageBatchValidationResult =
  | { readonly ok: true; readonly messages: ChatMessage[] }
  | { readonly ok: false; readonly error: string };

export function validateMessageBatch(
  messages: readonly unknown[]
): MessageBatchValidationResult {
  const validated: ChatMessage[] = [];
  const seen = new Set<string>();

  for (const raw of messages) {
    if (!isRecord(raw)) return { ok: false, error: "Invalid message id." };
    if (
      raw.clientMessageId !== undefined &&
      typeof raw.clientMessageId !== "string"
    ) {
      return { ok: false, error: "Invalid message id." };
    }
    const identity = resolveClientMessageId(raw as unknown as ChatMessage);
    if (!identity.ok) return { ok: false, error: identity.error };
    if (seen.has(identity.id)) {
      return { ok: false, error: "Duplicate message id in request." };
    }
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.content !== "string") {
      return { ok: false, error: "Invalid message content." };
    }
    const content = candidate.content.trim();
    if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
      return { ok: false, error: "Message content is too long." };
    }
    if (!content && parseAttachments(candidate.attachments).length === 0) {
      return {
        ok: false,
        error: "Message must include text or a valid attachment.",
      };
    }
    seen.add(identity.id);
    validated.push(raw as unknown as ChatMessage);
  }

  return { ok: true, messages: validated };
}


export function conversationTitleFromMessages(
  messages: readonly ChatMessage[]
): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = (firstUserMessage?.content ?? "New conversation").trim();
  return title.slice(0, 160) || "New conversation";
}

export function toConversationListItem(
  row: ConversationRecord
): ConversationListItem {
  return {
    id: row.id,
    title: row.title?.trim() || "New conversation",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: Attachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.size !== "number" ||
      typeof item.type !== "string" ||
      (item.kind !== "image" && item.kind !== "document")
    ) {
      continue;
    }
    attachments.push({
      id: item.id,
      name: item.name,
      size: item.size,
      type: item.type,
      kind: item.kind,
      contentAvailable: false,
    });
  }
  return attachments;
}

function parseSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSource[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    sources.push({
      id: item.id,
      title: item.title,
      ...(typeof item.section === "string" ? { section: item.section } : {}),
    });
  }
  return sources;
}

function parseApprovalStatus(value: unknown): ChatMessage["approvalStatus"] {
  if (typeof value !== "string") return undefined;
  return APPROVAL_STATUSES.find((status) => status === value);
}

function parsePendingApproval(value: unknown): PendingApprovalInfo | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.pendingApproval) ? value.pendingApproval : value;
  const { approvalId, toolName, summary, details } = candidate;
  if (
    typeof approvalId !== "string" ||
    !approvalId.trim() ||
    approvalId.length > 256 ||
    typeof toolName !== "string" ||
    !toolName.trim() ||
    toolName.length > 100 ||
    typeof summary !== "string" ||
    !summary.trim() ||
    summary.length > 500 ||
    !isRecord(details)
  ) {
    return null;
  }
  return {
    approvalId,
    toolName,
    summary,
    details: { ...details },
  };
}

function parseApprovalMetadataStatus(value: unknown): string | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  return value.status;
}

function resolveApprovalStatus(
  row: MessageRecord,
  metadata: unknown
): ChatMessage["approvalStatus"] {
  const status = parseApprovalMetadataStatus(metadata);
  if (status === "executed" || status === "completed" || status === "approved") {
    return "approved";
  }
  if (status === "rejected") return "rejected";
  if (status === "expired" || status === "failed") return "failed";
  return parseApprovalStatus(row.approval_status) ??
    (row.pending_approval ? "pending" : undefined);
}

function compareMessageRows(a: MessageRecord, b: MessageRecord): number {
  const ordinalDifference =
    (a.ordinal ?? Number.MAX_SAFE_INTEGER) -
    (b.ordinal ?? Number.MAX_SAFE_INTEGER);
  if (ordinalDifference !== 0) return ordinalDifference;
  const createdDifference = a.created_at.localeCompare(b.created_at);
  if (createdDifference !== 0) return createdDifference;
  return a.id.localeCompare(b.id);
}

export function toChatMessages(rows: readonly MessageRecord[]): ChatMessage[] {
  return [...rows].sort(compareMessageRows).map((row) => {
    const approvalStatus = resolveApprovalStatus(row, row.approval_metadata);
    const pendingApproval = parsePendingApproval(row.approval_metadata);
    const message: ChatMessage = {
      id: row.id,
      clientMessageId: row.client_message_id || row.id,
      ordinal: row.ordinal,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      createdAt: row.created_at,
      attachments: parseAttachments(row.attachments),
      sources: parseSources(row.sources),
      insufficientEvidence: Boolean(row.insufficient_evidence),
      ...(approvalStatus ? { approvalStatus } : {}),
      ...(pendingApproval && approvalStatus
        ? { pendingApproval }
        : {}),
    };
    return message;
  });
}

function parseSavedMessageIdentity(value: unknown): SavedMessageIdentity | null {
  if (!isRecord(value)) return null;
  const { clientMessageId, id } = value;
  if (typeof clientMessageId !== "string" || !clientMessageId.trim()) {
    return null;
  }
  return typeof id === "string" && id.trim()
    ? { clientMessageId, id }
    : { clientMessageId };
}

export function parseSavedMessageIdentities(
  value: unknown
): SavedMessageIdentityResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Saved message confirmation is invalid." };
  }
  const saved: SavedMessageIdentity[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const identity = parseSavedMessageIdentity(item);
    if (!identity || seen.has(identity.clientMessageId)) {
      return { ok: false, error: "Saved message confirmation is invalid." };
    }
    seen.add(identity.clientMessageId);
    saved.push(identity);
  }
  return { ok: true, saved };
}

export function resolveSavedMessageIdentities(
  inserts: readonly MessageInsert[],
  rows: readonly unknown[]
): SavedMessageIdentityResult {
  const parsed = parseSavedMessageIdentities(rows);
  if (!parsed.ok) return parsed;

  const requested = new Set(inserts.map((insert) => insert.client_message_id));
  const confirmed = new Set<string>();
  for (const identity of parsed.saved) {
    if (
      !requested.has(identity.clientMessageId) ||
      confirmed.has(identity.clientMessageId)
    ) {
      return { ok: false, error: "Saved message confirmation is invalid." };
    }
    confirmed.add(identity.clientMessageId);
  }
  if (confirmed.size !== requested.size) {
    return { ok: false, error: "Saved message confirmation is incomplete." };
  }
  return parsed;
}

export function toMessageInserts(
  conversationId: string,
  userId: string,
  messages: readonly ChatMessage[],
  startOrdinal = 0
): MessageInsert[] {
  const inserts: MessageInsert[] = [];
  messages.forEach((message, index) => {
    const content = message.content.trim();
    if (content.length > MAX_MESSAGE_CONTENT_LENGTH) return;
    const attachments = parseAttachments(message.attachments);
    if (!content && attachments.length === 0) return;
    const identity = resolveClientMessageId(message);
    if (!identity.ok) return;
    const approvalStatus = parseApprovalStatus(message.approvalStatus);
    inserts.push({
      conversation_id: conversationId,
      role: message.role,
      content,
      attachments,
      sources: parseSources(message.sources),
      insufficient_evidence: Boolean(message.insufficientEvidence),
      pending_approval: Boolean(message.pendingApproval),
      approval_status:
        approvalStatus ?? (message.pendingApproval ? "pending" : null),
      client_message_id: identity.id,
      ordinal: message.ordinal ?? startOrdinal + index,
      approval_metadata: message.pendingApproval
        ? { ...message.pendingApproval, status: approvalStatus ?? "pending" }
        : {},
      sender_id: userId,
    });
  });
  return inserts;
}
