import React from "react";

interface LogoMarkProps {
  className?: string;
}

/**
 * Marque Support brand mark: an original rounded-square app tile in the brand
 * turquoise, holding a white speech bubble with a white letter "M" inside. The
 * silhouette is inspired by modern messaging app tiles, but the bubble, tail
 * and letterform are drawn from scratch for this product and stay legible at
 * small sizes.
 */
export const LogoMark: React.FC<LogoMarkProps> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 40 40"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        id="marque-support-tile"
        x1="0"
        y1="0"
        x2="40"
        y2="40"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#25BBC8" />
        <stop offset="100%" stopColor="#0F8591" />
      </linearGradient>
    </defs>

    {/* Rounded-square brand tile */}
    <rect width="40" height="40" rx="11" fill="url(#marque-support-tile)" />

    {/* Original speech bubble outline with a bottom-left tail */}
    <path
      d="M13 10.5h14a5 5 0 0 1 5 5v5a5 5 0 0 1-5 5H20l-6.5 4 2.5-4H13a5 5 0 0 1-5-5v-5a5 5 0 0 1 5-5Z"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinejoin="round"
    />

    {/* White letter M inside the bubble */}
    <path
      d="M16.2 21.8V14.2l3.8 4.3 3.8-4.3v7.6"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
