import type { ChatMessage } from "@/types/chat";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      ordered[key] = stableValue(source[key]);
    }
    return ordered;
  }
  return value;
}

export function messageIdentity(message: ChatMessage): string {
  return message.clientMessageId || message.id;
}

export function messagePersistenceSignature(message: ChatMessage): string {
  const attachments = (message.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    kind: attachment.kind,
    contentAvailable: false,
  }));
  return JSON.stringify(
    stableValue({
      identity: messageIdentity(message),
      ordinal: message.ordinal ?? null,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      attachments,
      sources: message.sources ?? [],
      insufficientEvidence: Boolean(message.insufficientEvidence),
      pendingApproval: message.pendingApproval ?? null,
      approvalStatus: message.approvalStatus ?? null,
    })
  );
}

export function withOrdinals(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return messages.map((message, index) =>
    message.ordinal === undefined
      ? { ...message, ordinal: index }
      : message
  );
}

export function dirtyMessages(
  messages: readonly ChatMessage[],
  persisted: ReadonlyMap<string, string>
): ChatMessage[] {
  return messages.filter(
    (message) =>
      persisted.get(messageIdentity(message)) !==
      messagePersistenceSignature(message)
  );
}

export function recordPersistedMessages(
  persisted: Map<string, string>,
  messages: readonly ChatMessage[]
): Map<string, string> {
  for (const message of messages) {
    persisted.set(messageIdentity(message), messagePersistenceSignature(message));
  }
  return persisted;
}

export function recordConfirmedPersistedMessages(
  persisted: Map<string, string>,
  messages: readonly ChatMessage[],
  confirmedClientMessageIds: readonly string[]
): Map<string, string> {
  const confirmed = new Set(confirmedClientMessageIds);
  for (const message of messages) {
    const identity = messageIdentity(message);
    if (confirmed.has(identity)) {
      persisted.set(identity, messagePersistenceSignature(message));
    }
  }
  return persisted;
}
