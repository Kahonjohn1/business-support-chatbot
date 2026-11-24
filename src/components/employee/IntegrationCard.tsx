import { ArrowUpRight } from "lucide-react";
import type { Integration } from "@/lib/employee/mockData";
import { StatusBadge } from "./StatusBadge";

function integrationTone(status: Integration["status"]) {
  if (status === "Connected") return "success" as const;
  if (status === "Needs attention") return "warning" as const;
  return "neutral" as const;
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function IntegrationCard({ integration }: { integration: Integration }) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-selected-teal text-sm font-bold text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
          {initials(integration.name)}
        </span>
        <StatusBadge tone={integrationTone(integration.status)} dot={false}>
          {integration.status}
        </StatusBadge>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{integration.name}</h3>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {integration.category}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{integration.description}</p>
      <dl className="mt-4 space-y-1.5 border-t border-border pt-4 text-[11px]">
        {integration.connectedBy ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Connected by</dt>
            <dd className="font-medium text-foreground">{integration.connectedBy}</dd>
          </div>
        ) : null}
        {integration.lastSync ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Last sync</dt>
            <dd className="font-medium text-foreground">{integration.lastSync}</dd>
          </div>
        ) : null}
      </dl>
      <button
        type="button"
        disabled
        className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground opacity-75"
      >
        {integration.status === "Available" ? "Connect preview" : "Configure preview"}
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </article>
  );
}
