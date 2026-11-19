import type {
  Attachment,
  ChatMessage,
  ChatSource,
  MessageRole,
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
}

export interface MessageInsert {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly attachments: Attachment[];
  readonly sources: ChatSource[];
  readonly insufficient_evidence: boolean;
  readonly pending_approval: boolean;
  readonly approval_status: ChatMessage["approvalStatus"] | null;
  readonly sender_id: string;
}

const APPROVAL_STATUSES: readonly NonNullable<ChatMessage["approvalStatus"]>[] = [
  "pending",
  "approved",
  "rejected",
  "failed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function toChatMessages(rows: readonly MessageRecord[]): ChatMessage[] {
  return rows.map((row) => {
    const approvalStatus = parseApprovalStatus(row.approval_status);
    const message: ChatMessage = {
      id: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
      createdAt: row.created_at,
      attachments: parseAttachments(row.attachments),
      sources: parseSources(row.sources),
      insufficientEvidence: Boolean(row.insufficient_evidence),
      approvalStatus:
        approvalStatus ?? (row.pending_approval ? "pending" : undefined),
    };
    return message;
  });
}

export function toMessageInserts(
  conversationId: string,
  userId: string,
  messages: readonly ChatMessage[]
): MessageInsert[] {
  const inserts: MessageInsert[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content || content.length > 40000) continue;
    const approvalStatus = parseApprovalStatus(message.approvalStatus);
    inserts.push({
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      content,
      attachments: parseAttachments(message.attachments),
      sources: parseSources(message.sources),
      insufficient_evidence: Boolean(message.insufficientEvidence),
      pending_approval: Boolean(message.pendingApproval),
      approval_status:
        approvalStatus ?? (message.pendingApproval ? "pending" : null),
      sender_id: userId,
    });
  }
  return inserts;
}
