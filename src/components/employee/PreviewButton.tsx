import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface PreviewButtonProps {
  children: ReactNode;
  icon?: LucideIcon;
  variant?: "primary" | "secondary";
}

export function PreviewButton({ children, icon: Icon, variant = "primary" }: PreviewButtonProps) {
  return (
    <button
      type="button"
      disabled
      className={`inline-flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-semibold opacity-75 ${
        variant === "primary"
          ? "bg-muted text-muted-foreground"
          : "border border-border bg-surface text-muted-foreground"
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
