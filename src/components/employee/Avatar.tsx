import type { ReactNode } from "react";

const tones = [
  "bg-[#E4F7F9] text-[#0B5E68] dark:bg-[#102A2E] dark:text-[#7FD9E2]",
  "bg-[#E8EEF9] text-[#284B8C] dark:bg-[#1A2540] dark:text-[#A9C4FF]",
  "bg-[#F3EBFA] text-[#6B3FA0] dark:bg-[#2C2038] dark:text-[#D6B8F7]",
  "bg-[#EAF5EC] text-[#2F6B3F] dark:bg-[#1B2D21] dark:text-[#9DD3A9]",
  "bg-[#FFF1E6] text-[#9A4B16] dark:bg-[#382719] dark:text-[#F5C08B]",
];

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function toneFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return tones[hash % tones.length] ?? tones[0];
}

const sizes = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

interface AvatarProps {
  name: string;
  size?: keyof typeof sizes;
  className?: string;
}

export function Avatar({ name, size = "md", className = "" }: AvatarProps) {
  return (
    <span
      aria-label={name}
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${sizes[size]} ${toneFor(name)} ${className}`}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, className = "" }: { names: string[]; className?: string }) {
  return (
    <span className={`inline-flex items-center -space-x-2 ${className}`}>
      {names.map((name) => (
        <Avatar key={name} name={name} size="sm" className="ring-2 ring-surface" />
      ))}
    </span>
  );
}

export function AvatarWithName({ name, meta }: { name: string; meta?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        {meta ? <span className="block truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
    </span>
  );
}
