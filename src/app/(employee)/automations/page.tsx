import type { Metadata } from "next";
import { AlertCircle, PauseCircle, PlayCircle, Workflow } from "lucide-react";
import { activities, automations } from "@/lib/employee/mockData";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { AutomationTable } from "@/components/employee/AutomationTable";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { requirePermission } from "@/lib/employee/access";

export const metadata: Metadata = {
  title: "Automations",
};

export default async function AutomationsPage() {
  await requirePermission("automations:manage");

  const activeCount = automations.filter((item) => item.status === "Active").length;
  const pausedCount = automations.filter((item) => item.status === "Paused").length;
  const reviewCount = automations.filter((item) => item.status === "Needs review").length;
  const automationActivity = activities.filter((item) => item.kind === "automation");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workflow operations"
        title="Automations"
        description="Inspect scheduled workflows, event triggers, run health, and review requirements."
        actions={<PreviewButton icon={Workflow}>New automation</PreviewButton>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Active workflows</p>
            <PlayCircle className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(activeCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Running on preview schedules</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Paused</p>
            <PauseCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(pausedCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Requires owner review</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Needs review</p>
            <AlertCircle className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(reviewCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Checks before activation</p>
        </div>
      </div>

      <SectionCard
        title="Workflow library"
        description="Illustrative automation records with static success rates."
        bodyClassName="p-3 sm:p-4"
      >
        <AutomationTable automations={automations} />
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard
          title="Operational guidance"
          description="Suggested controls for the future automation system."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold text-foreground">Human approval gates</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Require review before workflows publish customer-facing content or change access.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-semibold text-foreground">Failure visibility</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Surface failed runs, retries, and owners in the activity timeline.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Automation activity" bodyClassName="p-4">
          <ActivityTimeline items={automationActivity} compact />
        </SectionCard>
      </div>
    </div>
  );
}
