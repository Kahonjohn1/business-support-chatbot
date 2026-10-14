import type { Attachment, AttachmentKind } from "@/types/chat";

// Frontend-only demo: files are never uploaded. Metadata is kept in memory and
// persisted; the actual file bytes are intentionally not stored anywhere.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
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
