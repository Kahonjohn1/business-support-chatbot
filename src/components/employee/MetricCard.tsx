import type { LucideIcon } from "lucide-react";

const tones = {
  teal: "bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]",
  blue: "bg-[#E8EEF9] text-[#284B8C] dark:bg-[#1A2540] dark:text-[#A9C4FF]",
  amber: "bg-[#FFF4E5] text-[#9A5A0B] dark:bg-[#3A2A17] dark:text-[#F1C27A]",
  violet: "bg-[#F2EBFA] text-[#6B3FA0] dark:bg-[#2C2038] dark:text-[#D6B8F7]",
};

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: keyof typeof tones;
}

export function MetricCard({ label, value, hint, icon: Icon, tone }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
