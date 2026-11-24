import type { Metadata } from "next";
import {
  Clock,
  FolderKanban,
  ListTodo,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { activities } from "@/lib/employee/mockData";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";

export const metadata: Metadata = {
  title: "Activity",
};

const activitySources: Array<{ label: string; icon: LucideIcon; count: number }> = [
  { label: "Projects", icon: FolderKanban, count: 12 },
  { label: "Tasks", icon: ListTodo, count: 28 },
  { label: "Approvals", icon: ShieldCheck, count: 9 },
  { label: "Team", icon: Users, count: 4 },
  { label: "Automations", icon: Workflow, count: 7 },
];

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audit surface"
        title="Activity"
        description="A chronological view of illustrative changes across projects, tasks, approvals, people, and automations."
        actions={<PreviewButton icon={SlidersHorizontal} variant="secondary">Filters</PreviewButton>}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="Workspace timeline"
          description="Newest preview events first."
          bodyClassName="p-4 sm:p-5"
        >
          <ActivityTimeline items={activities} />
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Event sources" bodyClassName="p-3">
            <ul className="space-y-1">
              {activitySources.map((source) => {
                const Icon = source.icon;
                return (
                  <li
                    key={source.label}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {source.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {String(source.count).padStart(2, "0")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <SectionCard title="Retention preview" bodyClassName="p-4">
            <div className="flex gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A production timeline should retain actor, action, timestamp, subject, and source for
                every event. This preview stores none of that data.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
