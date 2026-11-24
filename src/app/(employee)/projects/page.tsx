import type { Metadata } from "next";
import { CalendarDays, FolderKanban, Plus, SlidersHorizontal } from "lucide-react";
import { projects, type ProjectStatus } from "@/lib/employee/mockData";
import { AvatarStack } from "@/components/employee/Avatar";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { ProgressBar } from "@/components/employee/ProgressBar";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";

export const metadata: Metadata = {
  title: "Projects",
};

function projectTone(status: ProjectStatus) {
  if (status === "On track") return "success" as const;
  if (status === "At risk") return "warning" as const;
  if (status === "Blocked") return "danger" as const;
  return "neutral" as const;
}

const statusCounts: Array<{ label: string; value: number; tone: ProjectStatus }> = [
  { label: "On track", value: 3, tone: "On track" },
  { label: "At risk", value: 1, tone: "At risk" },
  { label: "Blocked", value: 1, tone: "Blocked" },
  { label: "Completed", value: 1, tone: "Completed" },
];

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery portfolio"
        title="Projects"
        description="Track delivery status, ownership, progress, and deadlines across the Marque portfolio."
        actions={
          <>
            <PreviewButton icon={SlidersHorizontal} variant="secondary">
              Filters
            </PreviewButton>
            <PreviewButton icon={Plus}>New project</PreviewButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusCounts.map((item) => (
          <div key={item.label} className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-xs">
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {String(item.value).padStart(2, "0")}
              </p>
            </div>
            <StatusBadge tone={projectTone(item.tone)} dot={false}>
              {item.label}
            </StatusBadge>
          </div>
        ))}
      </div>

      <SectionCard
        title="All projects"
        description="Five illustrative projects shown. Progress and dates are preview values."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Project</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Progress</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold">Team</th>
                <th className="px-4 py-3 font-semibold">Deadline</th>
                <th className="px-4 py-3 font-semibold">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-border/70 last:border-0 hover:bg-background/60">
                  <td className="px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                        <FolderKanban className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-muted-foreground">{project.code}</p>
                        <p className="mt-0.5 text-sm font-semibold text-foreground">{project.name}</p>
                        <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                          {project.summary}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge tone={projectTone(project.status)}>{project.status}</StatusBadge>
                  </td>
                  <td className="w-44 px-4 py-4">
                    <ProgressBar value={project.progress} />
                  </td>
                  <td className="px-4 py-4 text-xs font-medium text-foreground">{project.owner}</td>
                  <td className="px-4 py-4">
                    <AvatarStack names={project.team} />
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {project.dueDate}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs font-medium tabular-nums text-muted-foreground">
                    {project.taskCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
