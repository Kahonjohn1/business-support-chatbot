import type { Metadata } from "next";
import { FolderKanban, Plus, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { ProgressBar } from "@/components/employee/ProgressBar";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { getEmployeeCompanyData } from "@/lib/employee/workspaceData";
import {
  projectStatusLabels,
  projectStatusTone,
  type EmployeeProject,
  type ProjectStatus,
} from "@/lib/employee/operationalTypes";

export const metadata: Metadata = {
  title: "Projects",
};

const statusOrder: ProjectStatus[] = ["active", "planned", "blocked", "completed"];

export default async function ProjectsPage() {
  const { projects } = await getEmployeeCompanyData();
  const statusCounts = statusOrder.map((status) => ({
    label: projectStatusLabels[status],
    value: projects.filter((project) => project.status === status).length,
    status,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery portfolio"
        title="Projects"
        description="Track delivery status, ownership, progress, and recent updates across the projects available to your account."
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
          <div key={item.status} className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3.5 shadow-xs">
            <div>
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">
                {String(item.value).padStart(2, "0")}
              </p>
            </div>
            <StatusBadge tone={projectStatusTone(item.status)} dot={false}>
              {item.label}
            </StatusBadge>
          </div>
        ))}
      </div>

      <SectionCard
        title="All projects"
        description="Live records available through your company access policies."
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
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project: EmployeeProject) => (
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
                    <StatusBadge tone={projectStatusTone(project.status)}>
                      {project.statusLabel}
                    </StatusBadge>
                  </td>
                  <td className="w-44 px-4 py-4">
                    <ProgressBar value={project.progress} />
                  </td>
                  <td className="px-4 py-4 text-xs font-medium text-foreground">{project.owner}</td>
                  <td className="px-4 py-4">
                    {project.team.length > 0 ? (
                      <span className="inline-flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {project.team.slice(0, 4).join(", ")}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No assignees</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-xs text-muted-foreground">{project.updated}</td>
                  <td className="px-4 py-4 text-xs font-medium tabular-nums text-muted-foreground">
                    {project.taskCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {projects.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No projects are available to this account.
            </p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
