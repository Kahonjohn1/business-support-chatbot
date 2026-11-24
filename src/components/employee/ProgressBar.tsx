export function ProgressBar({
  value,
  label,
  className = "",
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="h-1.5 min-w-20 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-action-teal dark:bg-[#17A2B1]"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
        {label ?? `${clamped}%`}
      </span>
    </div>
  );
}
