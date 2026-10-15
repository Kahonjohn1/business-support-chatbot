import type { Attachment, AttachmentKind } from "@/types/chat";
import { MAX_FILE_BYTES, MAX_TOTAL_FILE_BYTES } from "@/lib/chatLimits";

// File bytes are held in memory for the active session and forwarded to the
// server for processing; only metadata is ever persisted.

export const MAX_ATTACHMENT_BYTES = MAX_FILE_BYTES; // 10 MB per file

// Mirrors the server's MAX_TOTAL_FILE_BYTES so the client can refuse an
// over-limit selection before it becomes a 413 that loses the composed message.
export const MAX_TOTAL_ATTACHMENT_BYTES = MAX_TOTAL_FILE_BYTES; // 25 MB across all files

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const ACCEPTED_MIME_TYPES = new Set(Object.values(EXTENSION_MIME_MAP));

export const ACCEPTED_FILE_INPUT =
  ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp," + Array.from(ACCEPTED_MIME_TYPES).join(",");

export function createAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function resolveMimeType(file: File): string | null {
  if (file.type && ACCEPTED_MIME_TYPES.has(file.type)) {
    return file.type;
  }
  return EXTENSION_MIME_MAP[getExtension(file.name)] ?? null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function totalAttachmentBytes(
  attachments: readonly Attachment[]
): number {
  return attachments.reduce(
    (total, attachment) => total + attachment.size,
    0
  );
}

/**
 * Returns a user-facing error when the combined size of the given attachments
 * exceeds the server's per-request file limit, or null when they fit. Sharing
 * this check keeps the client (selection and send time) aligned with the server.
 */
export function totalAttachmentSizeError(
  attachments: readonly Attachment[]
): string | null {
  const total = totalAttachmentBytes(attachments);
  if (total <= MAX_TOTAL_ATTACHMENT_BYTES) {
    return null;
  }
  return `Your attachments add up to ${formatFileSize(
    total
  )}, which exceeds the ${formatFileSize(
    MAX_TOTAL_ATTACHMENT_BYTES
  )} limit for a single message. Remove a file or start a new chat.`;
}

export function validateAttachmentFile(file: File): string | null {
  if (!resolveMimeType(file)) {
    return `"${file.name}" is not a supported file type. Use PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `"${file.name}" is larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`;
  }
  return null;
}

export function createAttachmentFromFile(file: File): Attachment {
  const mime = resolveMimeType(file) ?? file.type;
  const kind: AttachmentKind = mime.startsWith("image/") ? "image" : "document";

  return {
    id: createAttachmentId(),
    name: file.name,
    size: file.size,
    type: mime,
    kind,
    previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
    contentAvailable: true,
  };
}

export function revokeAttachmentPreview(attachment: Attachment): void {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

/**
 * Removes only the given attachments' file bytes from the session cache.
 *
 * The cache is shared across all conversations, so clearing it wholesale (for
 * example when starting a new chat or switching conversations) would drop files
 * still needed to retry or resend messages in other conversations. Callers must
 * therefore release just the attachments they own.
 */
export function releaseAttachmentFiles(
  attachments: readonly Attachment[],
  fileCache: Map<string, File>
): void {
  for (const attachment of attachments) {
    fileCache.delete(attachment.id);
  }
}
