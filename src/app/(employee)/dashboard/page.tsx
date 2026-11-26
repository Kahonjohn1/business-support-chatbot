import { AlertCircle, ClipboardCheck, FolderKanban } from "lucide-react";

import { requireEmployee } from "@/lib/employee/access";
import type { EmployeeTask } from "@/lib/employee/operationalTypes";
import { hasPermission } from "@/lib/employee/roles";
import { getEmployeeCompanyData } from "@/lib/employee/workspaceData";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { PageHeader } from "@/components/employee/PageHeader";
import { SectionCard } from "@/components/employee/SectionCard";

export const metadata = {
  title: "Home | Marque",
  description: "Your Marque home.",
};

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4 shadow-xs">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireEmployee();
  const user = session.user;
  const { projects, tasks, approvals, activities } = await getEmployeeCompanyData();

  const canReviewApprovals = hasPermission(user.role, "approvals:review");
  const companyView = canReviewApprovals;

  const isMyTask = (task: EmployeeTask) =>
    task.assigneeId === user.id || (task.assignee !== "Unassigned" && task.assignee === user.name);

  const relevantTasks = companyView ? tasks : tasks.filter(isMyTask);
  const relevantProjects = companyView
    ? projects
    : projects.filter(
        (project) =>
          project.owner === user.name ||
          tasks.some((task) => task.projectId === project.id && isMyTask(task)),
      );

  const activeProjects = relevantProjects.filter((project) => project.status === "active").length;
  const openTasks = relevantTasks.filter((task) => task.status !== "done").length;
  const pendingApprovals = canReviewApprovals
    ? approvals.filter((approval) => approval.status === "pending")
    : [];

  const attentionItems = [
    ...pendingApprovals.slice(0, 3).map((approval) => ({
      id: `approval-${approval.id}`,
      kind: "Approval",
      title: approval.title,
      meta: `Submitted ${approval.submitted}`,
      icon: ClipboardCheck,
    })),
    ...relevantProjects
      .filter((project) => project.status === "blocked")
      .slice(0, 2)
      .map((project) => ({
        id: `project-${project.id}`,
        kind: "Project",
        title: project.name,
        meta: project.blockers[0] ?? "Review project blockers",
        icon: FolderKanban,
      })),
    ...relevantTasks
      .filter(
        (task) =>
          task.status !== "done" && task.priority === "high" && task.assignee === "Unassigned",
      )
      .slice(0, 3)
      .map((task) => ({
        id: `task-${task.id}`,
        kind: "Task",
        title: task.title,
        meta: `${task.project} · ${task.priorityLabel} priority`,
        icon: AlertCircle,
      })),
  ].slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Welcome, ${user.name}`}
        title="Here's what's happening at Marque Technologies."
        description="A concise view of active work and what needs attention."
      />

      <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Active projects" value={activeProjects} />
        <Metric label="Open tasks" value={openTasks} />
        {canReviewApprovals ? (
          <Metric label="Pending approvals" value={pendingApprovals.length} />
        ) : null}
      </section>

      <SectionCard title="Needs attention" bodyClassName="p-0">
        {attentionItems.length > 0 ? (
          <ul className="divide-y divide-border">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {item.kind}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.meta}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground sm:px-5">
            Nothing needs attention right now. New approvals, blockers and high-priority work will
            appear here.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Recent activity" bodyClassName="p-4 sm:p-5">
        {activities.length > 0 ? (
          <ActivityTimeline items={activities.slice(0, 3)} compact />
        ) : (
          <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">
            No recent activity yet. Changes to projects, tasks and approvals will appear here.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
