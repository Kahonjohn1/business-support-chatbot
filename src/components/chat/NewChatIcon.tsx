import React from "react";

interface NewChatIconProps {
  className?: string;
}

/**
 * ChatGPT-style compose mark: an outlined chat bubble with a small pencil.
 * Drawn inline with non-scaling strokes to match the project's existing
 * Heroicons-style icons wherever the new-chat action appears.
 *
 * This is a generic compose concept, not any company's official branding.
 */
export const NewChatIcon: React.FC<NewChatIconProps> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Outlined message/chat bubble */}
    <g transform="translate(0.5 0) scale(0.68)">
      <path
        vectorEffect="non-scaling-stroke"
        d="M2.25 18l2.4-1.6a2.25 2.25 0 011.25-.38h11.1a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 5.25v10.5c0 .34.076.663.212.953z"
      />
    </g>
    {/* Compose pencil */}
    <g transform="translate(11.5 11) scale(0.52)">
      <path
        vectorEffect="non-scaling-stroke"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
      />
    </g>
  </svg>
);
