type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "violet";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success:
    "bg-[#E8F5EC] text-[#24703A] dark:bg-[#173020] dark:text-[#9BD7AC]",
  warning:
    "bg-[#FFF4E5] text-[#A15C0B] dark:bg-[#3A2A17] dark:text-[#F1C27A]",
  danger: "bg-danger-subtle text-danger",
  info: "bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]",
  violet:
    "bg-[#F2EBFA] text-[#6B3FA0] dark:bg-[#2C2038] dark:text-[#D6B8F7]",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-[#2F8B4E]",
  warning: "bg-[#C77B13]",
  danger: "bg-danger",
  info: "bg-action-teal",
  violet: "bg-[#8B5BC4]",
};

interface StatusBadgeProps {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
}

export function StatusBadge({ children, tone = "neutral", dot = true }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClasses[tone]}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} /> : null}
      {children}
    </span>
  );
}
