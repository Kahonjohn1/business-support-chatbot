import type { Metadata } from "next";
import {
  Activity as ActivityIcon,
  Clock,
  FolderKanban,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { AvatarWithName } from "@/components/employee/Avatar";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requireEmployee } from "@/lib/employee/access";
import type { ActivityItem } from "@/lib/employee/mockData";
import {
  auditOutcomeTone,
  getAuditLog,
  type AuditEventRecord,
} from "@/lib/employee/reviewData";

export const metadata: Metadata = {
  title: "Activity",
};

const sourceIcons: Record<string, LucideIcon> = {
  project: FolderKanban,
  task: ActivityIcon,
  approval: ShieldCheck,
  team: Users,
  automation: Workflow,
};

const positiveOutcomes = new Set(["permitted", "approved", "executed"]);
const negativeOutcomes = new Set(["denied", "rejected", "failed"]);

function permissionLabel(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Allowed" : "Not allowed";
}

export default async function ActivityPage() {
  await requireEmployee();
  const events = await getAuditLog();

  const timelineItems: ActivityItem[] = events.map((event) => ({
    id: event.id,
    actor: event.actor,
    action: event.action,
    target: event.target,
    time: event.time,
    group: event.group,
    kind: event.kind,
  }));

  const sourceCounts = [...new Set(events.map((event) => event.toolName).filter(Boolean))]
    .map((toolName) => ({
      label: toolName as string,
      count: events.filter((event) => event.toolName === toolName).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const outcomeCounts = [...new Set(events.map((event) => event.outcome))]
    .map((outcome) => ({
      outcome,
      label: events.find((event) => event.outcome === outcome)?.outcomeLabel ?? outcome,
      count: events.filter((event) => event.outcome === outcome).length,
    }))
    .sort((a, b) => b.count - a.count);

  const positiveCount = events.filter((event) => positiveOutcomes.has(event.outcome)).length;
  const negativeCount = events.filter((event) => negativeOutcomes.has(event.outcome)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audit surface"
        title="Activity"
        description="Chronological audit events available to your company membership."
        actions={
          <PreviewButton icon={SlidersHorizontal} variant="secondary">
            Filters
          </PreviewButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Audit events</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(events.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Records visible to this account</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Permitted outcomes</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(positiveCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Permitted, approved, executed</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Blocked outcomes</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(negativeCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Denied, rejected, failed</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Distinct tools</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(sourceCounts.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">From event tool names</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="Company audit timeline"
          description="Newest audit events first."
          bodyClassName="p-4 sm:p-5"
        >
          {timelineItems.length > 0 ? (
            <ActivityTimeline items={timelineItems} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No audit events are available to this account.
            </p>
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Event tools" bodyClassName="p-3">
            {sourceCounts.length > 0 ? (
              <ul className="space-y-1">
                {sourceCounts.map((source) => (
                  <li
                    key={source.label}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <Workflow className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {source.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {String(source.count).padStart(2, "0")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground">No tool names recorded.</p>
            )}
          </SectionCard>

          <SectionCard title="Outcome totals" bodyClassName="p-3">
            {outcomeCounts.length > 0 ? (
              <ul className="space-y-1">
                {outcomeCounts.map((item) => (
                  <li
                    key={item.outcome}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                  >
                    <StatusBadge tone={auditOutcomeTone(item.outcome)} dot={false}>
                      {item.label}
                    </StatusBadge>
                    <span className="tabular-nums text-muted-foreground">
                      {String(item.count).padStart(2, "0")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground">No outcomes recorded.</p>
            )}
          </SectionCard>

          <SectionCard title="Captured fields" bodyClassName="p-4">
            <div className="flex gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Each record includes its actor, action, outcome, tool, operation, request, approval,
                permission decision, error code, duration, occurred time, and details where present.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Audit event records"
        description="Raw fields from the company audit_events table."
        bodyClassName="p-3 sm:p-4"
      >
        <div className="space-y-3">
          {events.map((event: AuditEventRecord) => {
            const Icon = sourceIcons[event.kind] ?? ActivityIcon;
            return (
              <article
                key={event.id}
                className="rounded-xl border border-border bg-background p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={auditOutcomeTone(event.outcome)}>
                        {event.outcomeLabel}
                      </StatusBadge>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {event.target}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{event.id}</span>
                    </div>

                    <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                      <p>Action {event.action}</p>
                      <p>Operation {event.operation ?? "—"}</p>
                      <p>Occurred {event.occurredLabel}</p>
                      <p>Created {event.createdLabel}</p>
                      <p>Request {event.requestId ?? "—"}</p>
                      <p>Approval {event.approvalId ?? "—"}</p>
                      <p>Permission {permissionLabel(event.permissionAllowed)}</p>
                      <p>Required permission {event.requiredPermission ?? "—"}</p>
                      <p>Error code {event.errorCode ?? "—"}</p>
                      <p>Duration {event.durationMs === null ? "—" : `${event.durationMs} ms`}</p>
                    </div>

                    <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                      {event.detailsLabel}
                    </pre>

                    <div className="mt-3">
                      <AvatarWithName name={event.actor} meta={`Actor user ${event.actorId ?? "unknown"}`} />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {events.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No audit event records are available.
            </p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
