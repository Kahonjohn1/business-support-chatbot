import React from "react";
import type { Attachment } from "@/types/chat";
import { formatFileSize } from "@/lib/attachments";

interface AttachmentChipProps {
  attachment: Attachment;
  onRemove?: (id: string) => void;
}

function getBadgeLabel(attachment: Attachment): string {
  const index = attachment.name.lastIndexOf(".");
  if (index >= 0 && index < attachment.name.length - 1) {
    return attachment.name.slice(index + 1).toUpperCase().slice(0, 4);
  }
  return attachment.type.split("/").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
}

const ACCENT_BY_KIND: Record<Attachment["kind"], string> = {
  image: "text-primary",
  document: "text-muted-foreground",
};

export const AttachmentChip: React.FC<AttachmentChipProps> = ({
  attachment,
  onRemove,
}) => {
  const hasThumbnail =
    attachment.kind === "image" && Boolean(attachment.previewUrl);

  return (
    <div className="flex items-center gap-2 max-w-[230px] px-2 py-1.5 bg-surface border border-border rounded-xl shadow-xs">
      {hasThumbnail ? (
        <div
          role="img"
          aria-label={attachment.name}
          className="w-9 h-9 rounded-lg bg-background bg-cover bg-center border border-border shrink-0"
          style={{ backgroundImage: `url(${attachment.previewUrl})` }}
        />
      ) : (
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-background border border-border shrink-0"
          aria-hidden="true"
        >
          <svg
            className={`w-4.5 h-4.5 ${ACCENT_BY_KIND[attachment.kind]}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
          >
            {attachment.kind === "image" ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25a1.125 1.125 0 11-2.25 0 1.125 1.125 0 012.25 0z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            )}
          </svg>
        </div>
      )}

      <div className="flex flex-col min-w-0">
        <span
          className="text-xs font-medium text-foreground truncate"
          title={attachment.name}
        >
          {attachment.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {getBadgeLabel(attachment)} &middot; {formatFileSize(attachment.size)}
        </span>
        {!attachment.contentAvailable && (
          <span className="text-[10px] italic text-warning">
            Content not saved
          </span>
        )}
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          className="p-1 ml-0.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger-subtle transition-colors shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label={`Remove ${attachment.name}`}
          title={`Remove ${attachment.name}`}
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
};
